import type { ErrorCode } from "@gitnut/commons";

/** Error that maps 1:1 to an RpcError on the wire. */
export class GitnutError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const fail = (code: ErrorCode, message: string): never => {
  throw new GitnutError(code, message);
};
