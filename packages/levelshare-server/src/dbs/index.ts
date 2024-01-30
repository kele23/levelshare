import { SyncRequest, SyncResponse, compareSequence } from '@kele23/levelshare';
import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { UserTokenPayload } from '../auth/type.js';
import { verifyPermission } from '../user/index.js';
import { getSyncServer } from './sync.js';
import { FeedQuery, FeedQueryType, FeedResp, FeedRespType } from './type.js';

const DBPlugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {
    await fastify.after();

    fastify.route<{ Body: SyncRequest; Reply: SyncResponse }>({
        method: 'POST',
        url: '/dbs/:name/sync',
        schema: {
            description: 'Sync DB with name',
            tags: ['DBs'],
        },
        preHandler: fastify.auth([fastify.verifyJWT]),
        handler: async (req, rpl) => {
            const { name } = req.params as { name: string };
            const user = req.user as UserTokenPayload;
            const ok = verifyPermission(name, user);
            if (!ok) {
                throw 'Authorization denied';
            }

            const sync = await getSyncServer(name, fastify.db);
            const data = await sync.receive(req.body);
            rpl.send(data);
        },
    });

    fastify.route<{ Querystring: FeedQueryType; Body: FeedRespType }>({
        method: 'GET',
        url: '/dbs/:name/feed',
        schema: {
            querystring: FeedQuery,
            response: {
                200: FeedResp,
            },
            description: 'Get last feed value of DB with name',
            tags: ['DBs'],
        },
        preHandler: fastify.auth([fastify.verifyJWT]),
        handler: async (req, rpl) => {
            const { name } = req.params as { name: string };
            const user = req.user as UserTokenPayload;
            const ok = verifyPermission(name, user);
            if (!ok) {
                throw 'Authorization denied';
            }

            const sync = await getSyncServer(name, fastify.db);
            const nameDb = sync.db;

            const { type, from } = req.query;
            switch (type) {
                case 'longpolling': {
                    const currSeq = nameDb.sequence;
                    // if from not specified or currentSeq <= from, than wait next sync
                    if (!from || compareSequence(from, currSeq) >= 0)
                        await new Promise((resolve) => nameDb.once('db:sync', resolve));
                    rpl.status(200).send({ sequence: nameDb.sequence });
                    break;
                }
                case 'eventsource': {
                    break;
                }
                default: {
                    rpl.status(200).send({ sequence: nameDb.sequence });
                }
            }
        },
    });
};

export default fp(DBPlugin);
