import { Static, Type } from '@sinclair/typebox';

export const ErrorResp = Type.Object({
    message: Type.String(),
});

export type ErrorRespType = Static<typeof ErrorResp>;
