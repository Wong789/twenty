import {
  LEGACY_HALFTONE_SETTING_KEYS,
  isRoundedBandHalftoneSettings,
  type HalftoneExportPose,
  type HalftoneGeometrySpec,
  type HalftoneStudioSettings,
} from '@/app/halftone/_lib/state';

const VIRTUAL_RENDER_HEIGHT = 768;

const passThroughVertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const blurFragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D tInput;
  uniform vec2 dir;
  uniform vec2 res;

  varying vec2 vUv;

  void main() {
    vec4 sum = vec4(0.0);
    vec2 px = dir / res;

    float w[5];
    w[0] = 0.227027;
    w[1] = 0.1945946;
    w[2] = 0.1216216;
    w[3] = 0.054054;
    w[4] = 0.016216;

    sum += texture2D(tInput, vUv) * w[0];

    for (int i = 1; i < 5; i++) {
      float fi = float(i) * 3.0;
      sum += texture2D(tInput, vUv + px * fi) * w[i];
      sum += texture2D(tInput, vUv - px * fi) * w[i];
    }

    gl_FragColor = sum;
  }
`;

const imagePassthroughFragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D tImage;
  uniform vec2 imageSize;
  uniform vec2 viewportSize;
  uniform float zoom;
  uniform float contrast;

  varying vec2 vUv;

  void main() {
    float imageAspect = imageSize.x / imageSize.y;
    float viewAspect = viewportSize.x / viewportSize.y;

    vec2 uv = vUv;

    // Contain: show full image, letterbox/pillarbox as needed
    if (imageAspect > viewAspect) {
      float scale = viewAspect / imageAspect;
      uv.y = (uv.y - 0.5) / scale + 0.5;
    } else {
      float scale = imageAspect / viewAspect;
      uv.x = (uv.x - 0.5) / scale + 0.5;
    }

    uv = (uv - 0.5) / zoom + 0.5;

    float inBounds = step(0.0, uv.x) * step(uv.x, 1.0)
                   * step(0.0, uv.y) * step(uv.y, 1.0);

    vec4 color = texture2D(tImage, clamp(uv, 0.0, 1.0));
    vec3 contrastColor = clamp((color.rgb - 0.5) * contrast + 0.5, 0.0, 1.0);

    gl_FragColor = vec4(contrastColor, inBounds);
  }
`;

const halftoneFragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D tScene;
  uniform sampler2D tGlow;
  uniform vec2 resolution;
  uniform float tile;
  uniform float s_3;
  uniform float s_4;
  uniform vec3 dashColor;
  uniform float time;
  uniform float waveAmount;
  uniform float waveSpeed;
  uniform float distanceScale;
  uniform vec2 interactionUv;
  uniform vec2 interactionVelocity;
  uniform vec2 dragOffset;
  uniform float hoverLightStrength;
  uniform float hoverLightRadius;
  uniform float hoverFlowStrength;
  uniform float hoverFlowRadius;
  uniform float dragFlowStrength;
  uniform float cropToBounds;

  varying vec2 vUv;

  float distSegment(in vec2 p, in vec2 a, in vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float denom = max(dot(ba, ba), 0.000001);
    float h = clamp(dot(pa, ba) / denom, 0.0, 1.0);
    return length(pa - ba * h);
  }

  float lineSimpleEt(in vec2 p, in float r, in float thickness) {
    vec2 a = vec2(0.5) + vec2(-r, 0.0);
    vec2 b = vec2(0.5) + vec2(r, 0.0);
    float distToSegment = distSegment(p, a, b);
    float halfThickness = thickness * r;
    return distToSegment - halfThickness;
  }

  void main() {
    // Crop to image bounds: discard fragments outside source image (image mode only)
    if (cropToBounds > 0.5) {
      vec4 boundsCheck = texture2D(tScene, vUv);
      if (boundsCheck.a < 0.01) {
        gl_FragColor = vec4(0.0);
        return;
      }
    }

    float halftoneSize = max(tile / max(distanceScale, 0.001), 1.0);
    vec2 pointerPx = interactionUv * resolution;
    vec2 fragDelta = gl_FragCoord.xy - pointerPx;
    float fragDist = length(fragDelta);
    vec2 radialDir = fragDist > 0.001 ? fragDelta / fragDist : vec2(0.0, 1.0);
    float velocityMagnitude = length(interactionVelocity);
    vec2 motionDir = velocityMagnitude > 0.001
      ? interactionVelocity / velocityMagnitude
      : vec2(0.0, 0.0);
    float motionBias = velocityMagnitude > 0.001
      ? dot(-radialDir, motionDir) * 0.5 + 0.5
      : 0.5;

    float hoverLightMask = 0.0;
    if (hoverLightStrength > 0.0) {
      float lightRadiusPx = hoverLightRadius * resolution.y;
      hoverLightMask = smoothstep(lightRadiusPx, 0.0, fragDist);
    }

    float hoverFlowMask = 0.0;
    if (hoverFlowStrength > 0.0) {
      float hoverRadiusPx = hoverFlowRadius * resolution.y;
      hoverFlowMask = smoothstep(hoverRadiusPx, 0.0, fragDist);
    }

    vec2 hoverDisplacement =
      radialDir * hoverFlowStrength * hoverFlowMask * halftoneSize * 0.55 +
      motionDir * hoverFlowStrength * hoverFlowMask * (0.4 + motionBias) * halftoneSize * 1.15;
    vec2 travelDisplacement = dragOffset * dragFlowStrength * 0.45;
    vec2 effectCoord = gl_FragCoord.xy + hoverDisplacement + travelDisplacement;

    float bandRow = floor(effectCoord.y / halftoneSize);
    float waveOffset =
      waveAmount * sin(time * waveSpeed + bandRow * 0.5) * halftoneSize;
    effectCoord.x += waveOffset;

    vec2 cellIndex = floor(effectCoord / halftoneSize);
    vec2 sampleUv = clamp(
      (cellIndex + 0.5) * halftoneSize / resolution,
      vec2(0.0),
      vec2(1.0)
    );
    vec2 cellUv = fract(effectCoord / halftoneSize);

    vec4 sceneSample = texture2D(tScene, sampleUv);
    float mask = smoothstep(0.02, 0.08, sceneSample.a);
    float lightLift =
      hoverLightStrength * hoverLightMask * mix(0.78, 1.18, motionBias) * 0.22;
    float bandRadius = clamp(
      (
        (
          sceneSample.r +
          sceneSample.g +
          sceneSample.b +
          s_3 * length(vec2(0.5))
        ) *
        (1.0 / 3.0)
      ) + lightLift,
      0.0,
      1.0
    ) * 1.86 * 0.5;

    float alpha = 0.0;
    if (bandRadius > 0.0001) {
      float signedDistance = lineSimpleEt(cellUv, bandRadius, s_4);
      float edge = 0.02;
      alpha = (1.0 - smoothstep(0.0, edge, signedDistance)) * mask;
    }

    vec3 color = dashColor * alpha;
    gl_FragColor = vec4(color, alpha);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const GEOMETRY_RUNTIME_SOURCE = String.raw`
function makePolarShape(radiusFunction, segments = 320) {
  const shape = new THREE.Shape();

  for (let segmentIndex = 0; segmentIndex <= segments; segmentIndex += 1) {
    const angle = (segmentIndex / segments) * Math.PI * 2;
    const radius = radiusFunction(angle);
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;

    if (segmentIndex === 0) {
      shape.moveTo(x, y);
    } else {
      shape.lineTo(x, y);
    }
  }

  return shape;
}

function makeReliefGeometry(shape, options = {}) {
  const {
    bevelSegments = 8,
    bevelSize = 0.08,
    bevelThickness = 0.1,
    depth = 0.58,
    waveDepth = 0.016,
    waves = 8,
  } = options;

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    steps: 2,
    bevelEnabled: true,
    bevelThickness,
    bevelSize,
    bevelSegments,
    curveSegments: 96,
  });

  geometry.center();

  const position = geometry.attributes.position;
  let maxRadius = 0;

  for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex += 1) {
    maxRadius = Math.max(
      maxRadius,
      Math.hypot(position.getX(vertexIndex), position.getY(vertexIndex)),
    );
  }

  const fullDepth = depth + bevelThickness * 2;

  for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex += 1) {
    const x = position.getX(vertexIndex);
    const y = position.getY(vertexIndex);
    const z = position.getZ(vertexIndex);
    const radius = Math.hypot(x, y) / maxRadius;
    const angle = Math.atan2(y, x);
    const faceAmount = Math.min(1, Math.abs(z) / (fullDepth * 0.5));
    const rimLift = Math.exp(-Math.pow((radius - 0.84) / 0.12, 2));
    const innerDish = Math.exp(-Math.pow((radius - 0.42) / 0.2, 2));
    const wave =
      Math.cos(angle * waves) *
      Math.exp(-Math.pow((radius - 0.72) / 0.16, 2)) *
      waveDepth;
    const relief = faceAmount * (0.14 * rimLift - 0.055 * innerDish + wave);

    position.setZ(vertexIndex, z + (z >= 0 ? 1 : -1) * relief);
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return geometry;
}

function mergeGeometries(geometries) {
  if (geometries.length === 1) {
    return geometries[0];
  }

  let totalVertices = 0;
  let totalIndices = 0;
  let hasUv = false;

  const geometryInfos = geometries.map((geometry) => {
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    const uv = geometry.attributes.uv ?? null;
    const index = geometry.index;
    const indexCount = index ? index.count : position.count;

    totalVertices += position.count;
    totalIndices += indexCount;
    hasUv = hasUv || uv !== null;

    return {
      index,
      indexCount,
      normal,
      position,
      uv,
      vertexCount: position.count,
    };
  });

  const positions = new Float32Array(totalVertices * 3);
  const normals = new Float32Array(totalVertices * 3);
  const uvs = hasUv ? new Float32Array(totalVertices * 2) : null;
  const indices = new Uint32Array(totalIndices);

  let vertexOffset = 0;
  let indexOffset = 0;

  for (const geometryInfo of geometryInfos) {
    for (let vertexIndex = 0; vertexIndex < geometryInfo.vertexCount; vertexIndex += 1) {
      const positionOffset = (vertexOffset + vertexIndex) * 3;
      positions[positionOffset] = geometryInfo.position.getX(vertexIndex);
      positions[positionOffset + 1] = geometryInfo.position.getY(vertexIndex);
      positions[positionOffset + 2] = geometryInfo.position.getZ(vertexIndex);
      normals[positionOffset] = geometryInfo.normal.getX(vertexIndex);
      normals[positionOffset + 1] = geometryInfo.normal.getY(vertexIndex);
      normals[positionOffset + 2] = geometryInfo.normal.getZ(vertexIndex);

      if (uvs !== null) {
        const uvOffset = (vertexOffset + vertexIndex) * 2;
        uvs[uvOffset] = geometryInfo.uv?.getX(vertexIndex) ?? 0;
        uvs[uvOffset + 1] = geometryInfo.uv?.getY(vertexIndex) ?? 0;
      }
    }

    if (geometryInfo.index) {
      for (let localIndex = 0; localIndex < geometryInfo.indexCount; localIndex += 1) {
        indices[indexOffset + localIndex] =
          geometryInfo.index.getX(localIndex) + vertexOffset;
      }
    } else {
      for (let localIndex = 0; localIndex < geometryInfo.indexCount; localIndex += 1) {
        indices[indexOffset + localIndex] = localIndex + vertexOffset;
      }
    }

    vertexOffset += geometryInfo.vertexCount;
    indexOffset += geometryInfo.indexCount;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));

  if (uvs !== null) {
    merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  }

  merged.setIndex(new THREE.BufferAttribute(indices, 1));

  return merged;
}

function makeArrowTarget() {
  const targetParts = [];
  const arrowParts = [];
  const baseRadius = 1.35;
  const baseDepth = 0.32;
  const bevel = 0.12;
  const points = [];
  const segments = 16;

  points.push(new THREE.Vector2(0, -baseDepth / 2));
  points.push(new THREE.Vector2(baseRadius - bevel, -baseDepth / 2));

  for (let segmentIndex = 0; segmentIndex <= segments; segmentIndex += 1) {
    const angle = Math.PI / 2 + (segmentIndex / segments) * (Math.PI / 2);
    points.push(
      new THREE.Vector2(
        baseRadius - bevel + Math.cos(angle) * bevel,
        -baseDepth / 2 + bevel + Math.sin(angle) * bevel,
      ),
    );
  }

  points.push(new THREE.Vector2(baseRadius, baseDepth / 2 - bevel));

  for (let segmentIndex = 0; segmentIndex <= segments; segmentIndex += 1) {
    const angle = (segmentIndex / segments) * (Math.PI / 2);
    points.push(
      new THREE.Vector2(
        baseRadius - bevel + Math.cos(angle) * bevel,
        baseDepth / 2 - bevel + Math.sin(angle) * bevel,
      ),
    );
  }

  points.push(new THREE.Vector2(0, baseDepth / 2));

  const disc = new THREE.LatheGeometry(points, 64);
  disc.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  targetParts.push(disc);

  for (const radius of [0.45, 0.85, 1.22]) {
    const ring = new THREE.TorusGeometry(radius, 0.14, 16, 64);
    ring.applyMatrix4(
      new THREE.Matrix4().makeTranslation(0, 0, baseDepth / 2 + 0.04),
    );
    targetParts.push(ring);
  }

  const bump = new THREE.SphereGeometry(0.32, 32, 24, 0, Math.PI * 2, 0, Math.PI / 2);
  bump.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  bump.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, baseDepth / 2));
  targetParts.push(bump);

  const shaftLength = 1.5;
  const shaftRadius = 0.05;
  const shaft = new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLength, 10, 1);
  shaft.applyMatrix4(new THREE.Matrix4().makeTranslation(0, shaftLength / 2, 0));
  arrowParts.push(shaft);

  const head = new THREE.ConeGeometry(0.12, 0.35, 10);
  head.applyMatrix4(new THREE.Matrix4().makeTranslation(0, -0.15, 0));
  arrowParts.push(head);

  for (let finIndex = 0; finIndex < 3; finIndex += 1) {
    const finShape = new THREE.Shape();
    finShape.moveTo(0, 0);
    finShape.lineTo(0.22, 0.25);
    finShape.lineTo(0, 0.5);
    finShape.lineTo(0, 0);

    const finGeometry = new THREE.ExtrudeGeometry(finShape, {
      depth: 0.012,
      bevelEnabled: false,
    });

    finGeometry.applyMatrix4(new THREE.Matrix4().makeTranslation(0.05, 0, -0.006));
    finGeometry.applyMatrix4(
      new THREE.Matrix4().makeRotationY((finIndex * Math.PI * 2) / 3),
    );
    finGeometry.applyMatrix4(
      new THREE.Matrix4().makeTranslation(0, shaftLength - 0.45, 0),
    );
    arrowParts.push(finGeometry);
  }

  const nock = new THREE.SphereGeometry(0.065, 8, 8);
  nock.applyMatrix4(new THREE.Matrix4().makeTranslation(0, shaftLength + 0.03, 0));
  arrowParts.push(nock);

  const aim = new THREE.Matrix4().makeRotationX(Math.PI / 2.15);
  const tilt = new THREE.Matrix4().makeRotationZ(Math.PI / 5);
  const shift = new THREE.Matrix4().makeTranslation(0.15, 0.15, 0.12);

  for (const geometry of arrowParts) {
    geometry.applyMatrix4(aim);
    geometry.applyMatrix4(tilt);
    geometry.applyMatrix4(shift);
  }

  const merged = mergeGeometries([...targetParts, ...arrowParts]);
  merged.computeVertexNormals();
  merged.computeBoundingSphere();

  return merged;
}

function makeDollarCoin() {
  const parts = [];
  const baseRadius = 1.3;
  const baseDepth = 0.45;
  const bevel = 0.18;
  const points = [];
  const segments = 20;

  points.push(new THREE.Vector2(0, -baseDepth / 2));
  points.push(new THREE.Vector2(baseRadius - bevel, -baseDepth / 2));

  for (let segmentIndex = 0; segmentIndex <= segments; segmentIndex += 1) {
    const angle = -Math.PI / 2 + (segmentIndex / segments) * Math.PI;
    points.push(
      new THREE.Vector2(
        baseRadius - bevel + Math.cos(angle) * bevel,
        Math.sin(angle) * (baseDepth / 2),
      ),
    );
  }

  points.push(new THREE.Vector2(baseRadius - bevel, baseDepth / 2));
  points.push(new THREE.Vector2(0, baseDepth / 2));

  const disc = new THREE.LatheGeometry(points, 64);
  disc.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  parts.push(disc);

  const frontRim = new THREE.TorusGeometry(baseRadius - 0.22, 0.05, 12, 64);
  frontRim.applyMatrix4(
    new THREE.Matrix4().makeTranslation(0, 0, baseDepth / 2 - 0.01),
  );
  parts.push(frontRim);

  const backRim = new THREE.TorusGeometry(baseRadius - 0.22, 0.05, 12, 64);
  backRim.applyMatrix4(
    new THREE.Matrix4().makeTranslation(0, 0, -(baseDepth / 2 - 0.01)),
  );
  parts.push(backRim);

  const createDollarSign = () => {
    const geometries = [];
    const tubeRadius = 0.1;
    const curveRadius = 0.28;
    const verticalOffset = 0.22;

    const bar = new THREE.CylinderGeometry(0.05, 0.05, 1.3, 12);
    geometries.push(bar);

    const topArc = new THREE.TorusGeometry(curveRadius, tubeRadius, 16, 32, Math.PI);
    topArc.applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
    topArc.applyMatrix4(
      new THREE.Matrix4().makeTranslation(0.05, verticalOffset, 0),
    );
    geometries.push(topArc);

    const bottomArc = new THREE.TorusGeometry(curveRadius, tubeRadius, 16, 32, Math.PI);
    bottomArc.applyMatrix4(new THREE.Matrix4().makeRotationZ(-Math.PI / 2));
    bottomArc.applyMatrix4(
      new THREE.Matrix4().makeTranslation(-0.05, -verticalOffset, 0),
    );
    geometries.push(bottomArc);

    const topSerif = new THREE.CylinderGeometry(tubeRadius, tubeRadius, 0.22, 12);
    topSerif.applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
    topSerif.applyMatrix4(
      new THREE.Matrix4().makeTranslation(0.16, verticalOffset + curveRadius, 0),
    );
    geometries.push(topSerif);

    const bottomSerif = new THREE.CylinderGeometry(tubeRadius, tubeRadius, 0.22, 12);
    bottomSerif.applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
    bottomSerif.applyMatrix4(
      new THREE.Matrix4().makeTranslation(-0.16, -verticalOffset - curveRadius, 0),
    );
    geometries.push(bottomSerif);

    const diagonalLength = Math.sqrt(0.1 * 0.1 + (verticalOffset * 2) ** 2);
    const diagonalAngle = Math.atan2(verticalOffset * 2, 0.1);
    const diagonal = new THREE.CylinderGeometry(tubeRadius, tubeRadius, diagonalLength + 0.12, 12);
    diagonal.applyMatrix4(
      new THREE.Matrix4().makeRotationZ(diagonalAngle - Math.PI / 2),
    );
    geometries.push(diagonal);

    return geometries;
  };

  for (const geometry of createDollarSign()) {
    geometry.applyMatrix4(
      new THREE.Matrix4().makeTranslation(0, 0, baseDepth / 2 + 0.01),
    );
    parts.push(geometry);
  }

  for (const geometry of createDollarSign()) {
    geometry.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI));
    geometry.applyMatrix4(
      new THREE.Matrix4().makeTranslation(0, 0, -(baseDepth / 2 + 0.01)),
    );
    parts.push(geometry);
  }

  const merged = mergeGeometries(parts);
  merged.computeVertexNormals();
  merged.computeBoundingSphere();

  return merged;
}

function createBuiltinGeometry(shapeKey) {
  switch (shapeKey) {
    case 'torusKnot':
      return new THREE.TorusKnotGeometry(1, 0.35, 200, 32);
    case 'sphere':
      return new THREE.SphereGeometry(1.4, 64, 64);
    case 'torus':
      return new THREE.TorusGeometry(1, 0.45, 64, 100);
    case 'icosahedron':
      return new THREE.IcosahedronGeometry(1.4, 4);
    case 'box':
      return new THREE.BoxGeometry(2.1, 2.1, 2.1, 6, 6, 6);
    case 'cone':
      return new THREE.ConeGeometry(1.2, 2.4, 64, 10);
    case 'cylinder':
      return new THREE.CylinderGeometry(1, 1, 2.3, 64, 10);
    case 'octahedron':
      return new THREE.OctahedronGeometry(1.5, 2);
    case 'dodecahedron':
      return new THREE.DodecahedronGeometry(1.35, 1);
    case 'tetrahedron':
      return new THREE.TetrahedronGeometry(1.7, 1);
    case 'sunCoin':
      return makeReliefGeometry(
        makePolarShape(
          (angle) => 1 + 0.17 * Math.pow(0.5 + 0.5 * Math.cos(angle * 12), 1.5),
        ),
        { depth: 0.62, waves: 12, waveDepth: 0.018 },
      );
    case 'lotusCoin':
      return makeReliefGeometry(
        makePolarShape((angle) => 0.88 + 0.3 * Math.pow(Math.sin(angle * 4), 2)),
        { depth: 0.64, waves: 8, waveDepth: 0.014 },
      );
    case 'arrowTarget':
      return makeArrowTarget();
    case 'dollarCoin':
      return makeDollarCoin();
    default:
      return new THREE.TorusKnotGeometry(1, 0.35, 200, 32);
  }
}
`;

const IMPORTED_RUNTIME_SOURCE = String.raw`
const EMPTY_TEXTURE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8B7Q8AAAAASUVORK5CYII=';

function createLoadingManager() {
  const loadingManager = new THREE.LoadingManager();
  loadingManager.setURLModifier((url) =>
    /\.(png|jpe?g|webp|gif|bmp)$/i.test(url) ? EMPTY_TEXTURE_DATA_URL : url,
  );
  return loadingManager;
}

function normalizeImportedGeometry(geometry) {
  geometry.computeBoundingBox();

  let boundingBox = geometry.boundingBox;
  let center = new THREE.Vector3();
  let size = new THREE.Vector3();

  boundingBox?.getCenter(center);
  boundingBox?.getSize(size);
  geometry.translate(-center.x, -center.y, -center.z);

  const dimensions = [size.x, size.y, size.z];
  const thinnestAxis = dimensions.indexOf(Math.min(...dimensions));

  if (thinnestAxis === 0) {
    geometry.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI / 2));
  } else if (thinnestAxis === 1) {
    geometry.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  }

  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const radius = geometry.boundingSphere?.radius || 1;
  const scale = 1.6 / radius;
  geometry.scale(scale, scale, scale);

  geometry.computeBoundingBox();
  boundingBox = geometry.boundingBox;
  center = new THREE.Vector3();
  boundingBox?.getCenter(center);
  geometry.translate(-center.x, -center.y, -center.z);

  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return geometry;
}

function extractMergedGeometry(root, emptyMessage) {
  root.updateMatrixWorld(true);
  const geometries = [];

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.geometry) {
      return;
    }

    const geometry = object.geometry.clone();

    if (!geometry.attributes.normal) {
      geometry.computeVertexNormals();
    }

    geometry.applyMatrix4(object.matrixWorld);
    geometries.push(geometry);
  });

  if (geometries.length === 0) {
    throw new Error(emptyMessage);
  }

  return normalizeImportedGeometry(mergeGeometries(geometries));
}

function parseFbxGeometry(buffer, label) {
  const originalWarn = console.warn;

  console.warn = (...args) => {
    if (typeof args[0] === 'string' && args[0].startsWith('THREE.FBXLoader:')) {
      return;
    }

    originalWarn(...args);
  };

  try {
    const root = new FBXLoader(createLoadingManager()).parse(buffer, '');
    return extractMergedGeometry(root, label + ' did not contain any mesh geometry.');
  } finally {
    console.warn = originalWarn;
  }
}

function parseGlbGeometry(buffer, label) {
  return new Promise((resolve, reject) => {
    new GLTFLoader(createLoadingManager()).parse(
      buffer,
      '',
      (gltf) => {
        try {
          resolve(
            extractMergedGeometry(
              gltf.scene,
              label + ' did not contain any mesh geometry.',
            ),
          );
        } catch (error) {
          reject(error);
        }
      },
      reject,
    );
  });
}

async function loadImportedGeometryFromUrl(loader, modelUrl, label) {
  const response = await fetch(modelUrl);

  if (!response.ok) {
    throw new Error('Unable to load ' + label + ' from ' + modelUrl + '.');
  }

  const buffer = await response.arrayBuffer();

  if (loader === 'fbx') {
    return parseFbxGeometry(buffer, label);
  }

  return parseGlbGeometry(buffer, label);
}
`;

type ExportedShapeDescriptor = {
  filename: string | null;
  key: string;
  kind: HalftoneGeometrySpec['kind'];
  label: string;
  loader: HalftoneGeometrySpec['loader'] | null;
};

export type ParsedExportedPreset = {
  componentName: string | null;
  imageAssetReference: string | null;
  initialPose: HalftoneExportPose;
  modelAssetReference: string | null;
  settings: HalftoneStudioSettings;
  shape: ExportedShapeDescriptor;
};

function createDefaultExportPose(): HalftoneExportPose {
  return {
    autoElapsed: 0,
    rotateElapsed: 0,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    targetRotationX: 0,
    targetRotationY: 0,
    timeElapsed: 0,
  };
}

function normalizeExportPose(
  pose: HalftoneExportPose | undefined,
): HalftoneExportPose {
  const fallback = createDefaultExportPose();

  if (!pose) {
    return fallback;
  }

  return {
    autoElapsed: Number.isFinite(pose.autoElapsed) ? pose.autoElapsed : 0,
    rotateElapsed: Number.isFinite(pose.rotateElapsed) ? pose.rotateElapsed : 0,
    rotationX: Number.isFinite(pose.rotationX) ? pose.rotationX : 0,
    rotationY: Number.isFinite(pose.rotationY) ? pose.rotationY : 0,
    rotationZ: Number.isFinite(pose.rotationZ) ? pose.rotationZ : 0,
    targetRotationX: Number.isFinite(pose.targetRotationX)
      ? pose.targetRotationX
      : 0,
    targetRotationY: Number.isFinite(pose.targetRotationY)
      ? pose.targetRotationY
      : 0,
    timeElapsed: Number.isFinite(pose.timeElapsed) ? pose.timeElapsed : 0,
  };
}

function toPascalCase(value: string) {
  const tokens = value
    .replace(/\.[^.]+$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const joined = tokens
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join('');

  if (!joined) {
    return 'HalftoneDashes';
  }

  return /^[A-Za-z_]/.test(joined) ? joined : `Halftone${joined}`;
}

function extractSerializedJson<T>(
  content: string,
  name: string,
  nextName: string,
) {
  const pattern = new RegExp(
    String.raw`const\s+${name}\s*=\s*([\s\S]*?)\s*;\s*\r?\nconst\s+${nextName}\s*=`,
  );
  const match = content.match(pattern);

  if (!match) {
    throw new Error(`Could not find ${name} in the exported preset.`);
  }

  try {
    return JSON.parse(match[1]) as T;
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Could not parse ${name}: ${error.message}`
        : `Could not parse ${name}.`,
    );
  }
}

function extractFirstMatch(content: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = content.match(pattern);

    if (match && match.length > 1) {
      return match[match.length - 1] ?? null;
    }
  }

  return null;
}

function assertRoundedBandPreset(
  settings: HalftoneStudioSettings,
): asserts settings is HalftoneStudioSettings {
  if (isRoundedBandHalftoneSettings(settings.halftone)) {
    return;
  }

  const halftoneValue =
    settings.halftone && typeof settings.halftone === 'object'
      ? (settings.halftone as Record<string, unknown>)
      : null;
  const detectedLegacyKeys = LEGACY_HALFTONE_SETTING_KEYS.filter((key) =>
    halftoneValue ? key in halftoneValue : false,
  );
  const suffix =
    detectedLegacyKeys.length > 0
      ? ` Detected legacy keys: ${detectedLegacyKeys.join(', ')}.`
      : '';

  throw new Error(
    `This preset uses the legacy halftone effect and can no longer be imported.${suffix}`,
  );
}

export function parseExportedPreset(content: string): ParsedExportedPreset {
  const settings = extractSerializedJson<HalftoneStudioSettings>(
    content,
    'settings',
    'shape',
  );
  assertRoundedBandPreset(settings);
  const shape = extractSerializedJson<ExportedShapeDescriptor>(
    content,
    'shape',
    'initialPose',
  );
  const initialPose = normalizeExportPose(
    extractSerializedJson<HalftoneExportPose>(
      content,
      'initialPose',
      'VIRTUAL_RENDER_HEIGHT',
    ),
  );
  const componentName =
    extractFirstMatch(content, [
      /export\s+default\s+function\s+([A-Za-z0-9_]+)/,
      /<title>([^<]+)<\/title>/i,
    ]) ?? null;
  const modelAssetReference = extractFirstMatch(content, [
    /modelUrl\s*=\s*(['"`])([\s\S]*?)\1/,
    /modelUrl\s*:\s*(['"`])([\s\S]*?)\1/,
  ]);
  const imageAssetReference = extractFirstMatch(content, [
    /imageUrl\s*=\s*(['"`])([\s\S]*?)\1/,
    /imageUrl\s*:\s*(['"`])([\s\S]*?)\1/,
  ]);

  return {
    componentName,
    imageAssetReference,
    initialPose,
    modelAssetReference,
    settings,
    shape,
  };
}

export function deriveExportComponentName(
  shape: HalftoneGeometrySpec | undefined,
  importedFile: File | undefined,
) {
  const source =
    importedFile?.name ??
    shape?.filename ??
    shape?.label ??
    shape?.key ??
    'HalftoneDashes';

  return toPascalCase(source);
}

function createShapeDescriptor(
  shape: HalftoneGeometrySpec | undefined,
  settings: HalftoneStudioSettings,
  importedFile?: File,
  modelFilenameOverride?: string,
): ExportedShapeDescriptor {
  if (!shape) {
    return {
      filename: null,
      key: settings.shapeKey,
      kind: 'builtin',
      label: settings.shapeKey,
      loader: null,
    };
  }

  const effectiveImportedFilename =
    modelFilenameOverride ?? importedFile?.name ?? shape.filename ?? null;

  return {
    filename:
      shape.kind === 'imported'
        ? effectiveImportedFilename
        : (shape.filename ?? null),
    key: shape.key,
    kind: shape.kind,
    label:
      shape.kind === 'imported'
        ? (effectiveImportedFilename ?? shape.label)
        : shape.label,
    loader: shape.loader ?? null,
  };
}

function getModelMimeType(
  file: File,
  loader: HalftoneGeometrySpec['loader'] | null,
) {
  if (file.type) {
    return file.type;
  }

  if (loader === 'glb' || file.name.toLowerCase().endsWith('.glb')) {
    return 'model/gltf-binary';
  }

  if (loader === 'fbx' || file.name.toLowerCase().endsWith('.fbx')) {
    return 'application/octet-stream';
  }

  return 'application/octet-stream';
}

async function fileToDataUrl(
  file: File,
  loader: HalftoneGeometrySpec['loader'] | null,
) {
  const buffer = await file.arrayBuffer();
  const blob = new Blob([buffer], {
    type: getModelMimeType(file, loader),
  });

  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(reader.error ?? new Error(`Unable to read ${file.name}.`));
    };
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error(`Unable to encode ${file.name}.`));
        return;
      }

      resolve(reader.result);
    };

    reader.readAsDataURL(blob);
  });
}

function serializeRuntimeSource(
  settings: HalftoneStudioSettings,
  shape: ExportedShapeDescriptor,
  initialPose: HalftoneExportPose,
) {
  const isImageMode = settings.sourceMode === 'image';

  return `
const settings = ${JSON.stringify(settings, null, 2)};
const shape = ${JSON.stringify(shape, null, 2)};
const initialPose = ${JSON.stringify(initialPose, null, 2)};
const VIRTUAL_RENDER_HEIGHT = ${VIRTUAL_RENDER_HEIGHT};
const passThroughVertexShader = ${JSON.stringify(passThroughVertexShader)};
const blurFragmentShader = ${JSON.stringify(blurFragmentShader)};
const halftoneFragmentShader = ${JSON.stringify(halftoneFragmentShader)};
${isImageMode ? `const imagePassthroughFragmentShader = ${JSON.stringify(imagePassthroughFragmentShader)};` : ''}

${isImageMode ? '' : GEOMETRY_RUNTIME_SOURCE}

${isImageMode ? '' : IMPORTED_RUNTIME_SOURCE}

function createRenderTarget(width, height) {
  return new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
  });
}

function createInteractionState() {
  return {
    autoElapsed: initialPose.autoElapsed,
    activePointerId: null,
    dragging: false,
    mouseX: 0.5,
    mouseY: 0.5,
    pointerInside: false,
    pointerVelocityX: 0,
    pointerVelocityY: 0,
    pointerX: 0,
    pointerY: 0,
    rotateElapsed: initialPose.rotateElapsed,
    rotationX: initialPose.rotationX,
    rotationVelocityX: 0,
    rotationY: initialPose.rotationY,
    rotationVelocityY: 0,
    rotationZ: initialPose.rotationZ,
    rotationVelocityZ: 0,
    smoothedMouseX: 0.5,
    smoothedMouseY: 0.5,
    targetRotationX: initialPose.targetRotationX,
    targetRotationY: initialPose.targetRotationY,
    velocityX: 0,
    velocityY: 0,
  };
}

${
  isImageMode
    ? ''
    : `
function setPrimaryLightPosition(light, angleDegrees, height) {
  const lightAngle = (angleDegrees * Math.PI) / 180;
  light.position.set(Math.cos(lightAngle) * 5, height, Math.sin(lightAngle) * 5);
}

function applySpringStep(current, target, velocity, strength, damping) {
  const nextVelocity = (velocity + (target - current) * strength) * damping;
  const nextValue = current + nextVelocity;

  return {
    value: nextValue,
    velocity: nextVelocity,
  };
}

function resetInteractionState(interactionState) {
  interactionState.dragging = false;
  interactionState.mouseX = 0.5;
  interactionState.mouseY = 0.5;
  interactionState.targetRotationX = 0;
  interactionState.targetRotationY = 0;
  interactionState.velocityX = 0;
  interactionState.velocityY = 0;
  interactionState.rotationVelocityX = 0;
  interactionState.rotationVelocityY = 0;
  interactionState.rotationVelocityZ = 0;
  interactionState.autoElapsed = 0;
}

async function createGeometry(modelUrl) {
  if (shape.kind === 'imported' && shape.loader && modelUrl) {
    return loadImportedGeometryFromUrl(shape.loader, modelUrl, shape.label);
  }

  return createBuiltinGeometry(shape.key);
}
`
}
`;
}

function createMountScript() {
  return `
async function mountHalftoneCanvas(options) {
  const {
    container,
    modelUrl,
    onError,
  } = options;

  const getWidth = () => Math.max(container.clientWidth, 1);
  const getHeight = () => Math.max(container.clientHeight, 1);
  const getVirtualHeight = () => Math.max(VIRTUAL_RENDER_HEIGHT, getHeight());
  const getVirtualWidth = () =>
    Math.max(
      Math.round(getVirtualHeight() * (getWidth() / Math.max(getHeight(), 1))),
      1,
    );

  let geometry;

  try {
    geometry = await createGeometry(modelUrl);
  } catch (error) {
    onError?.(error);
    geometry = createBuiltinGeometry('torusKnot');
  }

  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  renderer.setSize(getVirtualWidth(), getVirtualHeight(), false);

  const canvas = renderer.domElement;
  canvas.style.cursor = settings.animation.followDragEnabled ? 'grab' : 'default';
  canvas.style.display = 'block';
  canvas.style.height = '100%';
  canvas.style.touchAction = 'none';
  canvas.style.width = '100%';
  container.appendChild(canvas);

  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const environmentTexture = pmremGenerator.fromScene(
    new RoomEnvironment(),
    0.04,
  ).texture;
  pmremGenerator.dispose();

  const scene3d = new THREE.Scene();
  scene3d.background = null;

  const baseCameraDistance = 4;
  const camera = new THREE.PerspectiveCamera(45, getWidth() / getHeight(), 0.1, 100);
  camera.position.z = baseCameraDistance;

  const primaryLight = new THREE.DirectionalLight(0xffffff, settings.lighting.intensity);
  setPrimaryLightPosition(
    primaryLight,
    settings.lighting.angleDegrees,
    settings.lighting.height,
  );
  scene3d.add(primaryLight);

  const fillLight = new THREE.DirectionalLight(
    0xffffff,
    settings.lighting.fillIntensity,
  );
  fillLight.position.set(-3, -1, 1);
  scene3d.add(fillLight);

  const ambientLight = new THREE.AmbientLight(
    0xffffff,
    settings.lighting.ambientIntensity,
  );
  scene3d.add(ambientLight);

  const material = new THREE.MeshPhysicalMaterial({
    color: 0xd4d0c8,
    roughness: settings.material.roughness,
    metalness: settings.material.metalness,
    envMap: environmentTexture,
    envMapIntensity: 0.25,
    clearcoat: 0,
    clearcoatRoughness: 0.08,
    reflectivity: 0.5,
    transmission: 0,
  });

  const mesh = new THREE.Mesh(geometry, material);
  scene3d.add(mesh);

  const sceneTarget = createRenderTarget(getVirtualWidth(), getVirtualHeight());
  const blurTargetA = createRenderTarget(getVirtualWidth(), getVirtualHeight());
  const blurTargetB = createRenderTarget(getVirtualWidth(), getVirtualHeight());
  const fullScreenGeometry = new THREE.PlaneGeometry(2, 2);
  const orthographicCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const blurHorizontalMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tInput: { value: null },
      dir: { value: new THREE.Vector2(1, 0) },
      res: { value: new THREE.Vector2(getVirtualWidth(), getVirtualHeight()) },
    },
    vertexShader: passThroughVertexShader,
    fragmentShader: blurFragmentShader,
  });

  const blurVerticalMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tInput: { value: null },
      dir: { value: new THREE.Vector2(0, 1) },
      res: { value: new THREE.Vector2(getVirtualWidth(), getVirtualHeight()) },
    },
    vertexShader: passThroughVertexShader,
    fragmentShader: blurFragmentShader,
  });

  const halftoneMaterial = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      tScene: { value: sceneTarget.texture },
      tGlow: { value: blurTargetB.texture },
      resolution: {
        value: new THREE.Vector2(getVirtualWidth(), getVirtualHeight()),
      },
      tile: { value: settings.halftone.scale },
      s_3: { value: settings.halftone.power },
      s_4: { value: settings.halftone.width },
      dashColor: { value: new THREE.Color(settings.halftone.dashColor) },
      time: { value: 0 },
      waveAmount: { value: 0 },
      waveSpeed: { value: 1 },
      distanceScale: { value: 1.0 },
      interactionUv: { value: new THREE.Vector2(0.5, 0.5) },
      interactionVelocity: { value: new THREE.Vector2(0, 0) },
      dragOffset: { value: new THREE.Vector2(0, 0) },
      hoverLightStrength: { value: 0 },
      hoverLightRadius: { value: 0.2 },
      hoverFlowStrength: { value: 0 },
      hoverFlowRadius: { value: 0.18 },
      dragFlowStrength: { value: 0 },
      cropToBounds: { value: 0 },
    },
    vertexShader: passThroughVertexShader,
    fragmentShader: halftoneFragmentShader,
  });

  const blurHorizontalScene = new THREE.Scene();
  blurHorizontalScene.add(
    new THREE.Mesh(fullScreenGeometry, blurHorizontalMaterial),
  );

  const blurVerticalScene = new THREE.Scene();
  blurVerticalScene.add(new THREE.Mesh(fullScreenGeometry, blurVerticalMaterial));

  const postScene = new THREE.Scene();
  postScene.add(new THREE.Mesh(fullScreenGeometry, halftoneMaterial));

  const interaction = createInteractionState();
  const autoRotateEnabled = settings.animation.autoRotateEnabled;
  const followHoverEnabled = settings.animation.followHoverEnabled;
  const followDragEnabled = settings.animation.followDragEnabled;
  const rotateEnabled = settings.animation.rotateEnabled;

  const syncSize = () => {
    const width = getWidth();
    const height = getHeight();
    const virtualWidth = getVirtualWidth();
    const virtualHeight = getVirtualHeight();

    renderer.setSize(virtualWidth, virtualHeight, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    sceneTarget.setSize(virtualWidth, virtualHeight);
    blurTargetA.setSize(virtualWidth, virtualHeight);
    blurTargetB.setSize(virtualWidth, virtualHeight);
    blurHorizontalMaterial.uniforms.res.value.set(virtualWidth, virtualHeight);
    blurVerticalMaterial.uniforms.res.value.set(virtualWidth, virtualHeight);
    halftoneMaterial.uniforms.resolution.value.set(virtualWidth, virtualHeight);
  };

  const resizeObserver = new ResizeObserver(syncSize);
  resizeObserver.observe(container);

  const updatePointerPosition = (event) => {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(rect.width, 1);
    const height = Math.max(rect.height, 1);

    interaction.mouseX = THREE.MathUtils.clamp(
      (event.clientX - rect.left) / width,
      0,
      1,
    );
    interaction.mouseY = THREE.MathUtils.clamp(
      (event.clientY - rect.top) / height,
      0,
      1,
    );
  };

  const handlePointerDown = (event) => {
    updatePointerPosition(event);
    if (!followDragEnabled) {
      return;
    }

    interaction.dragging = true;
    interaction.pointerX = event.clientX;
    interaction.pointerY = event.clientY;
    interaction.velocityX = 0;
    interaction.velocityY = 0;
    canvas.style.cursor = 'grabbing';
  };

  const handlePointerMove = (event) => {
    updatePointerPosition(event);
  };

  const handleWindowPointerMove = (event) => {
    updatePointerPosition(event);

    if (!interaction.dragging || !followDragEnabled) {
      return;
    }

    const deltaX = (event.clientX - interaction.pointerX) * settings.animation.dragSens;
    const deltaY = (event.clientY - interaction.pointerY) * settings.animation.dragSens;
    interaction.velocityX = deltaY;
    interaction.velocityY = deltaX;
    interaction.targetRotationY += deltaX;
    interaction.targetRotationX += deltaY;
    interaction.pointerX = event.clientX;
    interaction.pointerY = event.clientY;
  };

  const handlePointerLeave = () => {
    if (interaction.dragging) {
      return;
    }

    interaction.mouseX = 0.5;
    interaction.mouseY = 0.5;
  };

  const handlePointerUp = () => {
    interaction.dragging = false;
    canvas.style.cursor = followDragEnabled ? 'grab' : 'default';

    if (!settings.animation.springReturnEnabled) {
      return;
    }

    const springImpulse = Math.max(settings.animation.springStrength * 10, 1.2);
    interaction.rotationVelocityX += interaction.velocityX * springImpulse;
    interaction.rotationVelocityY += interaction.velocityY * springImpulse;
    interaction.rotationVelocityZ += interaction.velocityY * springImpulse * 0.12;
    interaction.targetRotationX = 0;
    interaction.targetRotationY = 0;
    interaction.velocityX = 0;
    interaction.velocityY = 0;
  };

  const handleWindowBlur = () => {
    handlePointerUp();
    handlePointerLeave();
  };

  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('pointerleave', handlePointerLeave);
  window.addEventListener('pointerup', handlePointerUp);
  window.addEventListener('pointermove', handleWindowPointerMove);
  window.addEventListener('blur', handleWindowBlur);
  canvas.addEventListener('pointerdown', handlePointerDown);

  const clock = new THREE.Clock();
  let animationFrameId = 0;

  const renderFrame = () => {
    animationFrameId = window.requestAnimationFrame(renderFrame);

    const delta = 1 / 60;
    const elapsedTime = initialPose.timeElapsed + clock.getElapsedTime();
    halftoneMaterial.uniforms.time.value = elapsedTime;

    let baseRotationX = 0;
    let baseRotationY = 0;
    let baseRotationZ = 0;
    let meshOffsetY = 0;
    let meshScale = 1;
    let lightAngle = settings.lighting.angleDegrees;
    let lightHeight = settings.lighting.height;

    if (autoRotateEnabled) {
      interaction.autoElapsed += delta;
      baseRotationY += interaction.autoElapsed * settings.animation.autoSpeed;
      baseRotationX += Math.sin(interaction.autoElapsed * 0.2) * settings.animation.autoWobble;
    }

    if (settings.animation.floatEnabled) {
      const floatPhase = elapsedTime * settings.animation.floatSpeed;
      const driftAmount = (settings.animation.driftAmount * Math.PI) / 180;

      meshOffsetY += Math.sin(floatPhase) * settings.animation.floatAmplitude;
      baseRotationX += Math.sin(floatPhase * 0.72) * driftAmount * 0.45;
      baseRotationZ += Math.cos(floatPhase * 0.93) * driftAmount * 0.3;
    }

    if (settings.animation.breatheEnabled) {
      meshScale *=
        1 +
        Math.sin(elapsedTime * settings.animation.breatheSpeed) *
          settings.animation.breatheAmount;
    }

    if (rotateEnabled) {
      interaction.rotateElapsed += delta;
      const rotateProgress = settings.animation.rotatePingPong
        ? Math.sin(interaction.rotateElapsed * settings.animation.rotateSpeed) * Math.PI
        : interaction.rotateElapsed * settings.animation.rotateSpeed;

      if (settings.animation.rotatePreset === 'axis') {
        const axisDirection =
          settings.animation.rotateAxis.startsWith('-') ? -1 : 1;
        const axisProgress = rotateProgress * axisDirection;

        if (
          settings.animation.rotateAxis === 'x' ||
          settings.animation.rotateAxis === 'xy' ||
          settings.animation.rotateAxis === '-x' ||
          settings.animation.rotateAxis === '-xy'
        ) {
          baseRotationX += axisProgress;
        }

        if (
          settings.animation.rotateAxis === 'y' ||
          settings.animation.rotateAxis === 'xy' ||
          settings.animation.rotateAxis === '-y' ||
          settings.animation.rotateAxis === '-xy'
        ) {
          baseRotationY += axisProgress;
        }

        if (
          settings.animation.rotateAxis === 'z' ||
          settings.animation.rotateAxis === '-z'
        ) {
          baseRotationZ += axisProgress;
        }
      } else if (settings.animation.rotatePreset === 'lissajous') {
        baseRotationX += Math.sin(rotateProgress * 0.85) * 0.65;
        baseRotationY += Math.sin(rotateProgress * 1.35 + 0.8) * 1.05;
        baseRotationZ += Math.sin(rotateProgress * 0.55 + 1.6) * 0.32;
      } else if (settings.animation.rotatePreset === 'orbit') {
        baseRotationX += Math.sin(rotateProgress * 0.75) * 0.42;
        baseRotationY += Math.cos(rotateProgress) * 1.2;
        baseRotationZ += Math.sin(rotateProgress * 1.25) * 0.24;
      } else if (settings.animation.rotatePreset === 'tumble') {
        baseRotationX += rotateProgress * 0.55;
        baseRotationY += Math.sin(rotateProgress * 0.8) * 0.9;
        baseRotationZ += Math.cos(rotateProgress * 1.1) * 0.38;
      }
    }

    if (settings.animation.lightSweepEnabled) {
      const lightPhase = elapsedTime * settings.animation.lightSweepSpeed;
      lightAngle += Math.sin(lightPhase) * settings.animation.lightSweepRange;
      lightHeight +=
        Math.cos(lightPhase * 0.85) *
        settings.animation.lightSweepHeightRange;
    }

    let targetX = baseRotationX;
    let targetY = baseRotationY;
    let easing = 0.12;

    if (followHoverEnabled) {
      const rangeRadians = (settings.animation.hoverRange * Math.PI) / 180;

      if (
        settings.animation.hoverReturn ||
        interaction.mouseX !== 0.5 ||
        interaction.mouseY !== 0.5
      ) {
        targetX += (interaction.mouseY - 0.5) * rangeRadians;
        targetY += (interaction.mouseX - 0.5) * rangeRadians;
      }

      easing = settings.animation.hoverEase;
    }

    if (followDragEnabled) {
      if (!interaction.dragging && settings.animation.dragMomentum) {
        interaction.targetRotationX += interaction.velocityX;
        interaction.targetRotationY += interaction.velocityY;
        interaction.velocityX *= 1 - settings.animation.dragFriction;
        interaction.velocityY *= 1 - settings.animation.dragFriction;
      }

      targetX += interaction.targetRotationX;
      targetY += interaction.targetRotationY;
      easing = settings.animation.dragFriction;
    }

    if (autoRotateEnabled && !followHoverEnabled && !followDragEnabled) {
      targetX = baseRotationX + interaction.targetRotationX;
      targetY = baseRotationY + interaction.targetRotationY;

      if (interaction.dragging) {
        targetX = interaction.targetRotationX;
        targetY = interaction.targetRotationY;
      }

      easing = 0.08;
    }

    if (settings.animation.springReturnEnabled) {
      const springX = applySpringStep(
        interaction.rotationX,
        targetX,
        interaction.rotationVelocityX,
        settings.animation.springStrength,
        settings.animation.springDamping,
      );
      const springY = applySpringStep(
        interaction.rotationY,
        targetY,
        interaction.rotationVelocityY,
        settings.animation.springStrength,
        settings.animation.springDamping,
      );
      const springZ = applySpringStep(
        interaction.rotationZ,
        baseRotationZ,
        interaction.rotationVelocityZ,
        settings.animation.springStrength,
        settings.animation.springDamping,
      );

      interaction.rotationX = springX.value;
      interaction.rotationY = springY.value;
      interaction.rotationZ = springZ.value;
      interaction.rotationVelocityX = springX.velocity;
      interaction.rotationVelocityY = springY.velocity;
      interaction.rotationVelocityZ = springZ.velocity;
    } else {
      interaction.rotationX += (targetX - interaction.rotationX) * easing;
      interaction.rotationY += (targetY - interaction.rotationY) * easing;
      interaction.rotationZ +=
        (baseRotationZ - interaction.rotationZ) *
        (settings.animation.rotatePingPong ? 0.18 : 0.12);
    }

    mesh.rotation.set(
      interaction.rotationX,
      interaction.rotationY,
      interaction.rotationZ,
    );
    mesh.position.y = meshOffsetY;
    mesh.scale.setScalar(meshScale);

    if (settings.animation.cameraParallaxEnabled) {
      const cameraRange = settings.animation.cameraParallaxAmount;
      const cameraEase = settings.animation.cameraParallaxEase;
      const centeredX = (interaction.mouseX - 0.5) * 2;
      const centeredY = (0.5 - interaction.mouseY) * 2;
      const orbitYaw = centeredX * cameraRange;
      const orbitPitch = centeredY * cameraRange * 0.7;
      const horizontalRadius = Math.cos(orbitPitch) * baseCameraDistance;
      const targetCameraX = Math.sin(orbitYaw) * horizontalRadius;
      const targetCameraY =
        Math.sin(orbitPitch) * baseCameraDistance * 0.85;
      const targetCameraZ = Math.cos(orbitYaw) * horizontalRadius;

      camera.position.x += (targetCameraX - camera.position.x) * cameraEase;
      camera.position.y += (targetCameraY - camera.position.y) * cameraEase;
      camera.position.z += (targetCameraZ - camera.position.z) * cameraEase;
    } else {
      camera.position.x += (0 - camera.position.x) * 0.12;
      camera.position.y += (0 - camera.position.y) * 0.12;
      camera.position.z += (baseCameraDistance - camera.position.z) * 0.12;
    }

    camera.lookAt(0, meshOffsetY * 0.2, 0);
    setPrimaryLightPosition(primaryLight, lightAngle, lightHeight);

    if (!settings.halftone.enabled) {
      renderer.setRenderTarget(null);
      renderer.clear();
      renderer.render(scene3d, camera);
      return;
    }

    renderer.setRenderTarget(sceneTarget);
    renderer.render(scene3d, camera);

    blurHorizontalMaterial.uniforms.tInput.value = sceneTarget.texture;
    renderer.setRenderTarget(blurTargetA);
    renderer.render(blurHorizontalScene, orthographicCamera);

    blurVerticalMaterial.uniforms.tInput.value = blurTargetA.texture;
    renderer.setRenderTarget(blurTargetB);
    renderer.render(blurVerticalScene, orthographicCamera);

    blurHorizontalMaterial.uniforms.tInput.value = blurTargetB.texture;
    renderer.setRenderTarget(blurTargetA);
    renderer.render(blurHorizontalScene, orthographicCamera);

    blurVerticalMaterial.uniforms.tInput.value = blurTargetA.texture;
    renderer.setRenderTarget(blurTargetB);
    renderer.render(blurVerticalScene, orthographicCamera);

    renderer.setRenderTarget(null);
    renderer.clear();
    renderer.render(postScene, orthographicCamera);
  };

  renderFrame();

  return () => {
    window.cancelAnimationFrame(animationFrameId);
    resizeObserver.disconnect();
    canvas.removeEventListener('pointermove', handlePointerMove);
    canvas.removeEventListener('pointerleave', handlePointerLeave);
    canvas.removeEventListener('pointerup', handlePointerUp);
    canvas.removeEventListener('pointercancel', handlePointerCancel);
    window.removeEventListener('blur', handleWindowBlur);
    canvas.removeEventListener('pointerdown', handlePointerDown);
    blurHorizontalMaterial.dispose();
    blurVerticalMaterial.dispose();
    halftoneMaterial.dispose();
    fullScreenGeometry.dispose();
    material.dispose();
    sceneTarget.dispose();
    blurTargetA.dispose();
    blurTargetB.dispose();
    environmentTexture.dispose();
    renderer.dispose();

    if (canvas.parentNode === container) {
      container.removeChild(canvas);
    }
  };
}
`;
}

function createImageMountScript() {
  return `
async function mountHalftoneCanvas(options) {
  const {
    container,
    imageUrl,
    onError,
  } = options;

  const getWidth = () => Math.max(container.clientWidth, 1);
  const getHeight = () => Math.max(container.clientHeight, 1);
  const getVirtualHeight = () => Math.max(VIRTUAL_RENDER_HEIGHT, getHeight());
  const getVirtualWidth = () =>
    Math.max(
      Math.round(getVirtualHeight() * (getWidth() / Math.max(getHeight(), 1))),
      1,
    );

  // Load image
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageUrl;
  });

  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  renderer.setSize(getVirtualWidth(), getVirtualHeight(), false);

  const canvas = renderer.domElement;
  canvas.style.cursor = 'default';
  canvas.style.display = 'block';
  canvas.style.height = '100%';
  canvas.style.touchAction = 'none';
  canvas.style.width = '100%';
  container.appendChild(canvas);

  const imageTexture = new THREE.Texture(image);
  imageTexture.colorSpace = THREE.SRGBColorSpace;
  imageTexture.needsUpdate = true;

  const sceneTarget = createRenderTarget(getVirtualWidth(), getVirtualHeight());
  const blurTargetA = createRenderTarget(getVirtualWidth(), getVirtualHeight());
  const blurTargetB = createRenderTarget(getVirtualWidth(), getVirtualHeight());
  const fullScreenGeometry = new THREE.PlaneGeometry(2, 2);
  const orthographicCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const imageMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tImage: { value: imageTexture },
      imageSize: { value: new THREE.Vector2(image.width, image.height) },
      viewportSize: { value: new THREE.Vector2(getVirtualWidth(), getVirtualHeight()) },
      zoom: { value: 1 },
      contrast: { value: settings.halftone.imageContrast },
    },
    vertexShader: passThroughVertexShader,
    fragmentShader: imagePassthroughFragmentShader,
  });

  const imageScene = new THREE.Scene();
  imageScene.add(new THREE.Mesh(fullScreenGeometry, imageMaterial));

  const blurHorizontalMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tInput: { value: null },
      dir: { value: new THREE.Vector2(1, 0) },
      res: { value: new THREE.Vector2(getVirtualWidth(), getVirtualHeight()) },
    },
    vertexShader: passThroughVertexShader,
    fragmentShader: blurFragmentShader,
  });

  const blurVerticalMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tInput: { value: null },
      dir: { value: new THREE.Vector2(0, 1) },
      res: { value: new THREE.Vector2(getVirtualWidth(), getVirtualHeight()) },
    },
    vertexShader: passThroughVertexShader,
    fragmentShader: blurFragmentShader,
  });

  const halftoneMaterial = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      tScene: { value: sceneTarget.texture },
      tGlow: { value: blurTargetB.texture },
      resolution: {
        value: new THREE.Vector2(getVirtualWidth(), getVirtualHeight()),
      },
      tile: { value: settings.halftone.scale },
      s_3: { value: settings.halftone.power },
      s_4: { value: settings.halftone.width },
      dashColor: { value: new THREE.Color(settings.halftone.dashColor) },
      time: { value: 0 },
      waveAmount: { value: 0 },
      waveSpeed: { value: settings.animation.waveSpeed },
      distanceScale: { value: 1.0 },
      interactionUv: { value: new THREE.Vector2(0.5, 0.5) },
      interactionVelocity: { value: new THREE.Vector2(0, 0) },
      dragOffset: { value: new THREE.Vector2(0, 0) },
      hoverLightStrength: { value: 0 },
      hoverLightRadius: { value: settings.animation.hoverLightRadius },
      hoverFlowStrength: { value: 0 },
      hoverFlowRadius: { value: 0.18 },
      dragFlowStrength: { value: 0 },
      cropToBounds: { value: 1 },
    },
    vertexShader: passThroughVertexShader,
    fragmentShader: halftoneFragmentShader,
  });

  const blurHorizontalScene = new THREE.Scene();
  blurHorizontalScene.add(new THREE.Mesh(fullScreenGeometry, blurHorizontalMaterial));

  const blurVerticalScene = new THREE.Scene();
  blurVerticalScene.add(new THREE.Mesh(fullScreenGeometry, blurVerticalMaterial));

  const postScene = new THREE.Scene();
  postScene.add(new THREE.Mesh(fullScreenGeometry, halftoneMaterial));

  const interaction = createInteractionState();
  const imagePointerFollow = 0.38;
  const imagePointerVelocityDamping = 0.82;

  const syncSize = () => {
    const virtualWidth = getVirtualWidth();
    const virtualHeight = getVirtualHeight();

    renderer.setSize(virtualWidth, virtualHeight, false);
    sceneTarget.setSize(virtualWidth, virtualHeight);
    blurTargetA.setSize(virtualWidth, virtualHeight);
    blurTargetB.setSize(virtualWidth, virtualHeight);
    blurHorizontalMaterial.uniforms.res.value.set(virtualWidth, virtualHeight);
    blurVerticalMaterial.uniforms.res.value.set(virtualWidth, virtualHeight);
    halftoneMaterial.uniforms.resolution.value.set(virtualWidth, virtualHeight);
    imageMaterial.uniforms.viewportSize.value.set(virtualWidth, virtualHeight);
  };

  const resizeObserver = new ResizeObserver(syncSize);
  resizeObserver.observe(container);

  const updatePointerPosition = (event, options = {}) => {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(rect.width, 1);
    const height = Math.max(rect.height, 1);

    const nextMouseX = THREE.MathUtils.clamp(
      (event.clientX - rect.left) / width, 0, 1,
    );
    const nextMouseY = THREE.MathUtils.clamp(
      (event.clientY - rect.top) / height, 0, 1,
    );

    const deltaX = nextMouseX - interaction.mouseX;
    const deltaY = nextMouseY - interaction.mouseY;

    interaction.mouseX = nextMouseX;
    interaction.mouseY = nextMouseY;
    interaction.pointerInside =
      interaction.dragging ||
      (event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom);

    if (options.resetVelocity) {
      interaction.pointerVelocityX = 0;
      interaction.pointerVelocityY = 0;
      interaction.smoothedMouseX = nextMouseX;
      interaction.smoothedMouseY = nextMouseY;
    } else {
      interaction.pointerVelocityX = deltaX;
      interaction.pointerVelocityY = deltaY;
    }

    return { deltaX, deltaY };
  };

  const releasePointerCapture = (pointerId) => {
    if (pointerId === null) {
      return;
    }

    if (!canvas.hasPointerCapture(pointerId)) {
      return;
    }

    try {
      canvas.releasePointerCapture(pointerId);
    } catch {
      // Ignore capture release failures during teardown.
    }
  };

  const handlePointerDown = (event) => {
    updatePointerPosition(event, { resetVelocity: true });
    interaction.pointerX = event.clientX;
    interaction.pointerY = event.clientY;
  };

  const handlePointerMove = (event) => {
    const resetVelocity = !interaction.pointerInside && !interaction.dragging;
    updatePointerPosition(
      event,
      resetVelocity ? { resetVelocity: true } : undefined,
    );
  };

  const handlePointerLeave = () => {
    if (interaction.dragging) {
      return;
    }

    interaction.pointerInside = false;
    interaction.pointerVelocityX = 0;
    interaction.pointerVelocityY = 0;
  };

  const handlePointerUp = (event) => {
    updatePointerPosition(event, { resetVelocity: true });
    releasePointerCapture(interaction.activePointerId);
    interaction.activePointerId = null;
    interaction.dragging = false;
    const rect = canvas.getBoundingClientRect();
    interaction.pointerInside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
  };

  const handlePointerCancel = () => {
    releasePointerCapture(interaction.activePointerId);
    interaction.activePointerId = null;
    interaction.dragging = false;
    interaction.pointerInside = false;
    interaction.pointerVelocityX = 0;
    interaction.pointerVelocityY = 0;
  };

  const handleWindowBlur = () => {
    handlePointerCancel();
  };

  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('pointerleave', handlePointerLeave);
  canvas.addEventListener('pointerup', handlePointerUp);
  canvas.addEventListener('pointercancel', handlePointerCancel);
  window.addEventListener('blur', handleWindowBlur);
  canvas.addEventListener('pointerdown', handlePointerDown);

  const clock = new THREE.Clock();
  let animationFrameId = 0;

  const renderFrame = () => {
    animationFrameId = window.requestAnimationFrame(renderFrame);

    const elapsedTime = clock.getElapsedTime();
    halftoneMaterial.uniforms.time.value = elapsedTime;
    const pointerActive = interaction.pointerInside;

    interaction.smoothedMouseX +=
      (interaction.mouseX - interaction.smoothedMouseX) * imagePointerFollow;
    interaction.smoothedMouseY +=
      (interaction.mouseY - interaction.smoothedMouseY) * imagePointerFollow;
    interaction.pointerVelocityX *= imagePointerVelocityDamping;
    interaction.pointerVelocityY *= imagePointerVelocityDamping;

    halftoneMaterial.uniforms.interactionUv.value.set(
      interaction.smoothedMouseX,
      1 - interaction.smoothedMouseY,
    );
    halftoneMaterial.uniforms.interactionVelocity.value.set(
      interaction.pointerVelocityX * getVirtualWidth(),
      -interaction.pointerVelocityY * getVirtualHeight(),
    );
    halftoneMaterial.uniforms.dragOffset.value.set(0, 0);
    halftoneMaterial.uniforms.hoverLightStrength.value =
      pointerActive && settings.animation.hoverLightEnabled
        ? settings.animation.hoverLightIntensity
        : 0;
    halftoneMaterial.uniforms.hoverLightRadius.value =
      settings.animation.hoverLightRadius;
    halftoneMaterial.uniforms.hoverFlowStrength.value = 0;
    halftoneMaterial.uniforms.hoverFlowRadius.value = 0.18;
    halftoneMaterial.uniforms.dragFlowStrength.value = 0;

    renderer.setRenderTarget(sceneTarget);
    renderer.render(imageScene, orthographicCamera);

    blurHorizontalMaterial.uniforms.tInput.value = sceneTarget.texture;
    renderer.setRenderTarget(blurTargetA);
    renderer.render(blurHorizontalScene, orthographicCamera);

    blurVerticalMaterial.uniforms.tInput.value = blurTargetA.texture;
    renderer.setRenderTarget(blurTargetB);
    renderer.render(blurVerticalScene, orthographicCamera);

    blurHorizontalMaterial.uniforms.tInput.value = blurTargetB.texture;
    renderer.setRenderTarget(blurTargetA);
    renderer.render(blurHorizontalScene, orthographicCamera);

    blurVerticalMaterial.uniforms.tInput.value = blurTargetA.texture;
    renderer.setRenderTarget(blurTargetB);
    renderer.render(blurVerticalScene, orthographicCamera);

    renderer.setRenderTarget(null);
    renderer.clear();
    renderer.render(postScene, orthographicCamera);
  };

  renderFrame();

  return () => {
    window.cancelAnimationFrame(animationFrameId);
    resizeObserver.disconnect();
    canvas.removeEventListener('pointermove', handlePointerMove);
    canvas.removeEventListener('pointerleave', handlePointerLeave);
    canvas.removeEventListener('pointerup', handlePointerUp);
    canvas.removeEventListener('pointercancel', handlePointerCancel);
    window.removeEventListener('blur', handleWindowBlur);
    canvas.removeEventListener('pointerdown', handlePointerDown);
    blurHorizontalMaterial.dispose();
    blurVerticalMaterial.dispose();
    halftoneMaterial.dispose();
    imageMaterial.dispose();
    imageTexture.dispose();
    fullScreenGeometry.dispose();
    sceneTarget.dispose();
    blurTargetA.dispose();
    blurTargetB.dispose();
    renderer.dispose();

    if (canvas.parentNode === container) {
      container.removeChild(canvas);
    }
  };
}
`;
}

export function getExportedModelFile(
  shape: HalftoneGeometrySpec | undefined,
  importedFile: File | undefined,
) {
  if (!shape || shape.kind !== 'imported' || !importedFile) {
    return null;
  }

  return importedFile;
}

export function generateReactComponent(
  settings: HalftoneStudioSettings,
  selectedShape: HalftoneGeometrySpec | undefined,
  componentName = 'HalftoneDashes',
  modelFilenameOverride?: string,
  initialPose?: HalftoneExportPose,
  importedFile?: File,
  imageFilename?: string,
  background = 'transparent',
) {
  const isImageMode = settings.sourceMode === 'image';
  const shape = createShapeDescriptor(
    selectedShape,
    settings,
    importedFile,
    modelFilenameOverride,
  );
  const pose = normalizeExportPose(initialPose);
  const defaultModelUrl =
    modelFilenameOverride ?? shape.filename ?? 'model.glb';
  const defaultImageUrl = imageFilename ?? 'image.png';
  if (isImageMode) {
    return `import { useEffect, useRef, type CSSProperties } from 'react';
import * as THREE from 'three';

${serializeRuntimeSource(settings, shape, pose)}

${createImageMountScript()}

type ${componentName}Props = {
  imageUrl?: string;
  style?: CSSProperties;
};

export default function ${componentName}({
  imageUrl = ${JSON.stringify(`./${defaultImageUrl}`)},
  style,
}: ${componentName}Props) {
  const mountReference = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = mountReference.current;

    if (!container) {
      return;
    }

    const unmount = mountHalftoneCanvas({
      container,
      imageUrl,
      onError: (error) => {
        console.error(error);
      },
    });

    return () => {
      void Promise.resolve(unmount).then((dispose) => dispose?.());
    };
  }, [imageUrl]);

  return (
    <div
      ref={mountReference}
      style={{
        background: ${JSON.stringify(background)},
        height: '100%',
        width: '100%',
        ...style,
      }}
    />
  );
}
`;
  }

  return `import { useEffect, useRef, type CSSProperties } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

${serializeRuntimeSource(settings, shape, pose)}

${createMountScript()}

type ${componentName}Props = {
  modelUrl?: string;
  style?: CSSProperties;
};

export default function ${componentName}({
  modelUrl = ${JSON.stringify(`./${defaultModelUrl}`)},
  style,
}: ${componentName}Props) {
  const mountReference = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = mountReference.current;

    if (!container) {
      return;
    }

    const unmount = mountHalftoneCanvas({
      container,
      modelUrl,
      onError: (error) => {
        console.error(error);
      },
    });

    return () => {
      void Promise.resolve(unmount).then((dispose) => dispose?.());
    };
  }, [modelUrl]);

  return (
    <div
      ref={mountReference}
      style={{
        background: ${JSON.stringify(background)},
        height: '100%',
        width: '100%',
        ...style,
      }}
    />
  );
}
`;
}

export async function generateStandaloneHtml(
  settings: HalftoneStudioSettings,
  selectedShape: HalftoneGeometrySpec | undefined,
  componentName = 'HalftoneDashes',
  modelFilenameOverride?: string,
  initialPose?: HalftoneExportPose,
  importedFile?: File,
  imageFilename?: string,
  background = 'transparent',
) {
  const isImageMode = settings.sourceMode === 'image';
  const shape = createShapeDescriptor(
    selectedShape,
    settings,
    importedFile,
    modelFilenameOverride,
  );
  const pose = normalizeExportPose(initialPose);
  const defaultImageUrl = imageFilename ?? 'image.png';
  const embeddedImportedModelUrl =
    !isImageMode && shape.kind === 'imported' && importedFile
      ? await fileToDataUrl(importedFile, shape.loader)
      : null;
  const defaultModelUrl =
    embeddedImportedModelUrl ??
    modelFilenameOverride ??
    shape.filename ??
    'model.glb';

  const threeImports = isImageMode
    ? `import * as THREE from 'three';`
    : `import * as THREE from 'three';
      import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
      import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
      import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';`;

  const mountScript = isImageMode
    ? createImageMountScript()
    : createMountScript();

  const mountCall = isImageMode
    ? `mountHalftoneCanvas({
        container,
        imageUrl: ${JSON.stringify(`./${defaultImageUrl}`)},
        onError: (error) => {
          console.error(error);
        },
      });`
    : `mountHalftoneCanvas({
        container,
        modelUrl: ${JSON.stringify(`./${defaultModelUrl}`)},
        onError: (error) => {
          console.error(error);
        },
      });`;

  const captionText = isImageMode
    ? `Place <code>${defaultImageUrl}</code> next to this HTML file.`
    : `Standalone export of the current halftone scene.
        ${
          shape.kind === 'imported'
            ? embeddedImportedModelUrl
              ? 'The uploaded model is embedded directly in this HTML file.'
              : `Place <code>${defaultModelUrl}</code> next to this HTML file to keep the current uploaded shape.`
            : ''
        }`;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${componentName}</title>
    <link rel="icon" href="data:," />
    <style>
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      html,
      body {
        height: 100%;
      }

      body {
        background: ${background};
        color: rgba(255, 255, 255, 0.72);
        font-family: system-ui, sans-serif;
        overflow: hidden;
      }

      #app {
        height: 100%;
        width: 100%;
      }

      #canvas-root {
        height: 100%;
        width: 100%;
      }

      .caption {
        background: rgba(18, 18, 22, 0.72);
        backdrop-filter: blur(16px);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        bottom: 20px;
        color: rgba(255, 255, 255, 0.8);
        font-size: 12px;
        left: 20px;
        line-height: 1.5;
        max-width: min(320px, calc(100vw - 40px));
        padding: 12px 14px;
        position: fixed;
      }

      .caption code {
        color: #9d90fa;
        font-family: ui-monospace, monospace;
      }
    </style>
  </head>
  <body>
    <div id="app">
      <div id="canvas-root"></div>
      <div class="caption">
        ${captionText}
      </div>
    </div>

    <script type="importmap">
      {
        "imports": {
          "three": "https://unpkg.com/three@0.183.2/build/three.module.js",
          "three/addons/": "https://unpkg.com/three@0.183.2/examples/jsm/"
        }
      }
    </script>
    <script type="module">
      ${threeImports}

      ${serializeRuntimeSource(settings, shape, pose)}

      ${mountScript}

      const container = document.getElementById('canvas-root');

      ${mountCall}
    </script>
  </body>
</html>`;
}
