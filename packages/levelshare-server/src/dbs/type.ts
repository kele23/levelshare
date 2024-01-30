import { Static, Type } from '@sinclair/typebox';

const UFeed = Type.Union([Type.Literal('standard'), Type.Literal('longpolling'), Type.Literal('eventsource')]);
export const FeedQuery = Type.Object({
    type: Type.Optional(UFeed),
    from: Type.Optional(Type.String()),
});

export type FeedQueryType = Static<typeof FeedQuery>;

export const FeedResp = Type.Object({
    sequence: Type.String(),
});

export type FeedRespType = Static<typeof FeedResp>;
