// React 18 act() support outside a full renderer setup.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
