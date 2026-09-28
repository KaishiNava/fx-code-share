'use strict';

const crypto = require('crypto');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function ask(question) {
    return new Promise(resolve => {
        rl.question(question, answer => resolve(answer));
    });
}

(async () => {
    console.log('');
    console.log('======================================');
    console.log(' FX PROJECT - PASSWORD HASH GENERATOR');
    console.log('======================================');
    console.log('');

    const password = await ask('Masukkan password admin: ');
    rl.close();

    if (!password || password.length < 8) {
        console.error('\nPassword minimal 8 karakter.');
        process.exit(1);
    }

    const salt = crypto.randomBytes(16).toString('hex');

    const hash = crypto.scryptSync(
        password,
        salt,
        64
    ).toString('hex');

    const result = `${salt}:${hash}`;

    console.log('');
    console.log('HASH PASSWORD:');
    console.log('');
    console.log(result);
    console.log('');
    console.log('======================================');
    console.log('Copy nilai di atas ke config/admin.json');
    console.log('======================================');
    console.log('');
})();