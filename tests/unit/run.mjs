import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tests = [];
globalThis.test = (name, fn) => tests.push({ name, fn });

await import(pathToFileURL(path.join(__dirname, 'web-ui-logic.test.mjs')));
await import(pathToFileURL(path.join(__dirname, 'reset-main.test.mjs')));

let failures = 0;
for (const { name, fn } of tests) {
    try {
        await fn();
        console.log(`\u2713 ${name}`);
    } catch (err) {
        failures += 1;
        console.error(`\u2717 ${name}`);
        console.error(err);
    }
}

if (failures) {
    console.error(`Failed ${failures} test(s).`);
    process.exit(1);
} else {
    console.log(`All ${tests.length} tests passed.`);
}
