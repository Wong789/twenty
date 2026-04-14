import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';

// Use the locally bundled monaco-editor instead of loading from cdn.jsdelivr.net
// This avoids failures in regions where the CDN is blocked (e.g. Russia)
loader.config({ monaco });
