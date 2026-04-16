import { AGENT_CAPABILITY_DEFAULTS } from '../../constants/agent-capability-defaults.const';
import { isAgentCapabilityEnabled } from '../is-agent-capability-enabled.util';

describe('isAgentCapabilityEnabled', () => {
  it('returns the shared defaults when an agent does not override a capability', () => {
    expect(isAgentCapabilityEnabled(undefined, 'webSearch')).toBe(
      AGENT_CAPABILITY_DEFAULTS.webSearch,
    );
    expect(isAgentCapabilityEnabled(undefined, 'twitterSearch')).toBe(
      AGENT_CAPABILITY_DEFAULTS.twitterSearch,
    );
    expect(isAgentCapabilityEnabled(undefined, 'codeInterpreter')).toBe(
      AGENT_CAPABILITY_DEFAULTS.codeInterpreter,
    );
  });

  it('prefers explicit agent configuration over the shared defaults', () => {
    const modelConfiguration = {
      webSearch: { enabled: false },
      twitterSearch: { enabled: true },
      codeInterpreter: { enabled: false },
    };

    expect(isAgentCapabilityEnabled(modelConfiguration, 'webSearch')).toBe(
      false,
    );
    expect(isAgentCapabilityEnabled(modelConfiguration, 'twitterSearch')).toBe(
      true,
    );
    expect(
      isAgentCapabilityEnabled(modelConfiguration, 'codeInterpreter'),
    ).toBe(false);
  });
});
