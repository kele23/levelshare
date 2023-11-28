const doLog = (str: string, data: any[], level: 'log' | 'debug' | 'warn' | 'error' | 'info') => {
    const finalStr = '[levelshare] ' + str;
    switch (level) {
        case 'info':
        case 'log':
            console.log(finalStr, ...data);
            break;
        case 'debug':
            console.debug(finalStr, ...data);
            break;
        case 'warn':
            console.warn(finalStr, ...data);
            break;
        case 'error':
            console.error(finalStr, ...data);
            break;
    }
};

export const logger = {
    info: (str: string, ...data: any[]) => {
        doLog(str, data, 'info');
    },
    log: (str: string, ...data: any[]) => {
        doLog(str, data, 'log');
    },
    debug: (str: string, ...data: any[]) => {
        doLog(str, data, 'debug');
    },
    warn: (str: string, ...data: any[]) => {
        doLog(str, data, 'warn');
    },
    error: (str: string, ...data: any[]) => {
        doLog(str, data, 'error');
    },
};
