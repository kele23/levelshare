import bcrypt from 'bcrypt';
import { FastifyInstance } from 'fastify';
import { Level } from 'level';
import { nanoid } from 'nanoid';
import { User, UserTokenPayload } from './type.js';

export const ADMIN_USER = 'admin';
export const ADMINISTRATOR_ROLE = 'administrator';

/**
 *
 * @param {username,password} Check if username password belong to user
 * @param userDb The userDB
 * @throws
 * @returns true if login successfull
 */
export const checkLogin = async (
    { username, password }: { username: string; password: string },
    userDb: Level<string, User>,
): Promise<void> => {
    const user = await userDb.get(username);
    if (!(await bcrypt.compare(password, user.password))) {
        throw new Error('Invalid login');
    }
};

/**
 *
 * @param username The username
 * @param userDb The userDB
 * @returns The user if found, undefined if not found
 */
export const getUser = async (username: string, userDb: Level<string, User>): Promise<User> => {
    return await userDb.get(username);
};

/**
 *
 * @param param0
 * @param userDb
 */
export const createUser = async ([username, user]: [username: string, user: User], userDb: Level<string, User>) => {
    const realUser = {
        ...user,
        password: await bcrypt.hash(user.password, 10),
    };
    userDb.put(username, realUser);
};

/**
 * Check if administrator role exists
 * @param userDb
 */
export const checkInitUsers = async (fastify: FastifyInstance, userDb: Level<string, User>) => {
    try {
        await userDb.get(ADMIN_USER);
    } catch (e) {
        const password = nanoid(20);
        await createUser(
            [
                ADMIN_USER,
                {
                    password,
                    roles: [ADMINISTRATOR_ROLE],
                },
            ],
            userDb,
        );
        fastify.log.warn(`Created admin user with password ${password}`);
    }
};

export const verifyPermission = (dbName: string, user: UserTokenPayload) => {
    let permit = false;
    if (dbName == user.username) permit = true;
    if (user.roles.includes(dbName)) permit = true;
    if (user.roles.includes(ADMINISTRATOR_ROLE)) permit = true;
    return permit;
};
