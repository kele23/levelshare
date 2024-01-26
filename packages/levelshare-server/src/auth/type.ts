import { Static, Type } from '@sinclair/typebox';

////////////////// STATIC
export type User = {
    password: string;
    roles: string[];
};

export type UserTokenPayload = {
    username: string;
    roles: string[];
    refresh?: boolean;
};

///////////////// DTO
export const LoginReq = Type.Object({
    username: Type.String(),
    password: Type.String(),
});

export type LoginReqType = Static<typeof LoginReq>;

export const LoginResp = Type.Object({
    token: Type.String(),
    refreshToken: Type.String(),
});

export type LoginRespType = Static<typeof LoginResp>;

export const RefreshReq = Type.Object({
    refreshToken: Type.String(),
});

export type RefreshReqType = Static<typeof RefreshReq>;

export const CheckResp = Type.Object({
    username: Type.String(),
    roles: Type.Array(Type.String()),
});

export type CheckRespType = Static<typeof CheckResp>;
