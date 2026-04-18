function createConcurrencyLimiter(maxConcurrency) {
    const max = Number.isFinite(Number(maxConcurrency))
        ? Math.max(1, Math.floor(Number(maxConcurrency)))
        : 8;
    let active = 0;
    const queue = [];
    const next = () => {
        const resolve = queue.shift();
        if (resolve) resolve();
    };
    return async (task) => {
        if (active >= max) {
            await new Promise((resolve) => queue.push(resolve));
        }
        active += 1;
        try {
            return await task();
        } finally {
            active -= 1;
            next();
        }
    };
}

module.exports = {
    createConcurrencyLimiter
};

