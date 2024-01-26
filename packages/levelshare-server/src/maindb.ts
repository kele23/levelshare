import { FastifyInstance, FastifyPluginAsync, FastifyPluginOptions } from 'fastify';
import fp from 'fastify-plugin';
import { Level } from 'level';

declare module 'fastify' {
    interface FastifyInstance {
        db: Level<string, any>;
    }
}

export type MainDBOptions = {
    location: string;
};

const MainDB: FastifyPluginAsync<MainDBOptions> = async (fastify: FastifyInstance, options: FastifyPluginOptions) => {
    const db = new Level<string, any>(options.location);
    fastify.decorate('db', db);
};

export default fp(MainDB);
