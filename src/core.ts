export { debug, error, getInput, info, setFailed, setOutput, warning } from '@actions/core';

export const logger = {
  debug: (message: string) => {
    // eslint-disable-next-line no-console
    console.log(`[DEBUG] ${message}`);
  },
  info: (message: string) => {
    // eslint-disable-next-line no-console
    console.log(`[INFO] ${message}`);
  },
  warning: (message: string) => {
    // eslint-disable-next-line no-console
    console.warn(`[WARNING] ${message}`);
  },
  error: (message: string) => {
    // eslint-disable-next-line no-console
    console.error(`[ERROR] ${message}`);
  },
};
