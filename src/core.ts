import { debug, error, info, warning } from '@actions/core';

export { debug, error, getInput, info, setFailed, setOutput, warning } from '@actions/core';

export const logger = {
  debug: (message: string) => debug(message),
  info: (message: string) => info(message),
  warning: (message: string) => warning(message),
  error: (message: string) => error(message),
};
