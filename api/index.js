'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const MAX_FILE_SIZE = 2 * 1024 * 1024;
const SESSION_DURATION = 8 * 60 * 60;

const EXTENSIONS = {
    js: 'JavaScript',
    mjs: 'JavaScript',
    cjs: 'JavaScript',
    ts: 'TypeScript',
    jsx: 'React JSX',
    tsx: 'React TSX',
    html: 'HTML',
    htm: 'HTML',
    css: 'CSS',
    scss: 'SCSS',
    sass: 'Sass',
    less: 'Less',
    json: 'JSON',
    jsonc: 'JSON',
    md: 'Markdown',
    txt: 'Text',
    py: 'Python',
    java: 'Java',
    c: 'C',
    h: 'C Header',
    cpp: 'C++',
    hpp: 'C++ Header',
    cs: 'C#',
    go: 'Go',
    rs: 'Rust',
    php: 'PHP',
    rb: 'Ruby',
    kt: 'Kotlin',
    swift: 'Swift',
    dart: 'Dart',
    lua: 'Lua',
    sh: 'Shell',
    bash: 'Shell',
    yml: 'YAML',
    yaml: 'YAML',
    xml: 'XML',
    sql: 'SQL',
    vue: 'Vue',
    svelte: 'Svelte',
    env: 'Environment',
    conf: 'Config',
    ini: 'INI'
};

const DATA_PATH = 'data/index.json';
const REQUEST_PATH = 'requests/index.json';
const BANNER_PATH = 'config/banner.json';
const ANNOUNCEMENT_PATH = 'announcements/index.json';

/* ============================================================
   ENVIRONMENT
============================================================ */

function requiredEnv(name) {
    const value = process.env[name];

    if (!value) {
        throw new Error(
            `Environment variable ${name} belum diatur.`
        );
    }

    return value;
}

function getConfig() {
    return {
        owner: requiredEnv('GITHUB_OWNER'),
        repo: requiredEnv('GITHUB_REPO'),
        branch: process.env.GITHUB_BRANCH || 'main',
        token: requiredEnv('GITHUB_TOKEN'),
        sessionSecret: requiredEnv('SESSION_SECRET')
    };
}

/* ============================================================
   GITHUB API
============================================================ */

function githubHeaders(config) {
    return {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${config.token}`,
        'X-GitHub-Api-Version': '2026-03-10',
        'User-Agent': 'FX-Project-Code-Share'
    };
}

function githubUrl(config, filePath) {
    const encodedPath = filePath
        .split('/')
        .map(part => encodeURIComponent(part))
        .join('/');

    return `https://api.github.com/repos/${encodeURIComponent(
        config.owner
    )}/${encodeURIComponent(
        config.repo
    )}/contents/${encodedPath}`;
}

async function githubRequest(
    config,
    url,
    options = {}
) {
    const response = await fetch(
        url,
        {
            ...options,
            headers: {
                ...githubHeaders(config),
                ...(options.headers || {})
            }
        }
    );

    const text = await response.text();

    let data = null;

    try {
        data = text
            ? JSON.parse(text)
            : null;
    } catch {
        data = text;
    }

    return {
        ok: response.ok,
        status: response.status,
        data
    };
}

async function getGithubFile(
    config,
    filePath
) {
    const result =
        await githubRequest(
            config,
            githubUrl(
                config,
                filePath
            )
        );

    if (result.status === 404) {
        return null;
    }

    if (!result.ok) {
        throw new Error(
            `GitHub GET ${filePath} gagal: ${result.status}`
        );
    }

    if (
        !result.data ||
        !result.data.content
    ) {
        throw new Error(
            `GitHub file ${filePath} tidak memiliki content.`
        );
    }

    const content =
        Buffer
            .from(
                result.data.content
                    .replace(/\n/g, ''),
                'base64'
            )
            .toString('utf8');

    return {
        content,
        sha: result.data.sha,
        size:
            result.data.size ||
            Buffer.byteLength(content)
    };
}

/* ============================================================
   GITHUB PUT
============================================================ */

async function putGithubFile(
    config,
    filePath,
    content,
    message
) {
    let lastError = null;

    for (
        let attempt = 0;
        attempt < 4;
        attempt++
    ) {
        try {
            const existing =
                await getGithubFile(
                    config,
                    filePath
                );

            const body = {
                message,
                content:
                    Buffer
                        .from(
                            content,
                            'utf8'
                        )
                        .toString('base64'),
                branch:
                    config.branch
            };

            if (
                existing &&
                existing.sha
            ) {
                body.sha =
                    existing.sha;
            }

            const result =
                await githubRequest(
                    config,
                    githubUrl(
                        config,
                        filePath
                    ),
                    {
                        method: 'PUT',
                        headers: {
                            'Content-Type':
                                'application/json'
                        },
                        body:
                            JSON.stringify(
                                body
                            )
                    }
                );

            if (result.ok) {
                return result.data;
            }

            if (
                result.status === 409
            ) {
                lastError =
                    new Error(
                        `GitHub conflict saat update ${filePath}`
                    );

                await new Promise(
                    resolve =>
                        setTimeout(
                            resolve,
                            250 *
                                (attempt +
                                    1)
                        )
                );

                continue;
            }

            throw new Error(
                result.data?.message ||
                `GitHub PUT ${filePath} gagal (${result.status})`
            );
        } catch (error) {
            lastError = error;

            if (attempt < 3) {
                await new Promise(
                    resolve =>
                        setTimeout(
                            resolve,
                            250 *
                                (attempt +
                                    1)
                        )
                );
            }
        }
    }

    throw (
        lastError ||
        new Error(
            'GitHub update gagal.'
        )
    );
}

/* ============================================================
   GITHUB DELETE
============================================================ */

async function deleteGithubFile(
    config,
    filePath,
    message
) {
    let lastError = null;

    for (
        let attempt = 0;
        attempt < 4;
        attempt++
    ) {
        const existing =
            await getGithubFile(
                config,
                filePath
            );

        if (!existing) {
            return true;
        }

        const result =
            await githubRequest(
                config,
                githubUrl(
                    config,
                    filePath
                ),
                {
                    method: 'DELETE',
                    headers: {
                        'Content-Type':
                            'application/json'
                    },
                    body:
                        JSON.stringify({
                            message,
                            sha:
                                existing.sha,
                            branch:
                                config.branch
                        })
                }
            );

        if (result.ok) {
            return true;
        }

        if (
            result.status === 409
        ) {
            lastError =
                new Error(
                    `GitHub conflict saat delete ${filePath}`
                );

            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        250 *
                            (attempt +
                                1)
                    )
            );

            continue;
        }

        throw new Error(
            result.data?.message ||
            `GitHub DELETE ${filePath} gagal (${result.status})`
        );
    }

    throw (
        lastError ||
        new Error(
            'GitHub delete gagal.'
        )
    );
}

/* ============================================================
   UTILITIES
============================================================ */

function safeId() {
    return crypto
        .randomBytes(9)
        .toString('base64url')
        .replace(
            /[^a-zA-Z0-9_-]/g,
            ''
        )
        .slice(0, 12);
}

function cleanText(
    value,
    maxLength
) {
    return String(value || '')
        .replace(/\u0000/g, '')
        .trim()
        .slice(0, maxLength);
}

function safeFilename(
    filename
) {
    let value = String(
        filename ||
            'untitled.txt'
    )
        .replace(/\\/g, '/')
        .split('/')
        .pop()
        .trim();

    value = value
        .replace(
            /[<>:"|?*\x00-\x1F]/g,
            '_'
        )
        .replace(
            /\s+/g,
            '_'
        );

    if (!value) {
        value =
            'untitled.txt';
    }

    return value.slice(
        0,
        180
    );
}

function getExtension(
    filename
) {
    const match =
        filename
            .toLowerCase()
            .match(
                /\.([a-z0-9]+)$/
            );

    return match
        ? match[1]
        : 'txt';
}

function detectLanguage(
    filename
) {
    const ext =
        getExtension(
            filename
        );

    if (EXTENSIONS[ext]) {
        return EXTENSIONS[ext];
    }

    return 'Text';
}

function parseJsonSafely(
    content,
    fallback
) {
    try {
        return JSON.parse(
            content
        );
    } catch {
        return fallback;
    }
}

/* ============================================================
   CODE INDEX
============================================================ */

async function getIndex(
    config
) {
    const file =
        await getGithubFile(
            config,
            DATA_PATH
        );

    if (!file) {
        return [];
    }

    const parsed =
        parseJsonSafely(
            file.content,
            []
        );

    if (
        !Array.isArray(parsed)
    ) {
        return [];
    }

    return parsed;
}

async function saveIndex(
    config,
    posts
) {
    const sorted =
        [...posts].sort(
            (a, b) =>
                new Date(
                    b.updatedAt ||
                    b.createdAt
                ).getTime() -
                new Date(
                    a.updatedAt ||
                    a.createdAt
                ).getTime()
        );

    await putGithubFile(
        config,
        DATA_PATH,
        JSON.stringify(
            sorted,
            null,
            2
        ),
        'FX Project: update posts index'
    );

    return sorted;
}

/* ============================================================
   REQUEST STORAGE
============================================================ */

async function getRequests(
    config
) {
    const file =
        await getGithubFile(
            config,
            REQUEST_PATH
        );

    if (!file) {
        return [];
    }

    const parsed =
        parseJsonSafely(
            file.content,
            []
        );

    if (
        !Array.isArray(parsed)
    ) {
        return [];
    }

    return parsed;
}

async function saveRequests(
    config,
    requests
) {
    await putGithubFile(
        config,
        REQUEST_PATH,
        JSON.stringify(
            requests,
            null,
            2
        ),
        'FX Project: update scrape requests'
    );

    return requests;
}

/* ============================================================
   SITE BANNER / ANNOUNCEMENTS STORAGE
============================================================ */

const DEFAULT_BANNER = {
    enabled: false,
    url: '',
    type: 'auto',
    updatedAt: null
};

async function getBanner(config) {
    const file = await getGithubFile(config, BANNER_PATH);

    if (!file) {
        return { ...DEFAULT_BANNER };
    }

    const parsed = parseJsonSafely(file.content, DEFAULT_BANNER);

    return {
        ...DEFAULT_BANNER,
        ...(parsed && typeof parsed === 'object' ? parsed : {})
    };
}

async function saveBanner(config, banner) {
    await putGithubFile(
        config,
        BANNER_PATH,
        JSON.stringify(banner, null, 2),
        'FX Project: update site banner'
    );

    return banner;
}

async function getAnnouncements(config) {
    const file = await getGithubFile(config, ANNOUNCEMENT_PATH);

    if (!file) {
        return [];
    }

    const parsed = parseJsonSafely(file.content, []);

    return Array.isArray(parsed) ? parsed : [];
}

async function saveAnnouncements(config, announcements) {
    await putGithubFile(
        config,
        ANNOUNCEMENT_PATH,
        JSON.stringify(announcements, null, 2),
        'FX Project: update announcements'
    );

    return announcements;
}

function validHttpUrl(value) {
    try {
        const url = new URL(String(value || '').trim());
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

function inferBannerType(url, requestedType = 'auto') {
    const type = String(requestedType || 'auto').toLowerCase();

    if (type === 'image' || type === 'video') {
        return type;
    }

    const clean = String(url || '').split('?')[0].split('#')[0].toLowerCase();

    if (/\.(mp4|webm|ogg|mov)$/.test(clean)) {
        return 'video';
    }

    return 'image';
}

/* ============================================================
   PUBLIC SITE CONFIG
============================================================ */

async function actionSite(req, res, config) {
    const banner = await getBanner(config);
    const announcements = await getAnnouncements(config);

    const activeAnnouncements = announcements
        .filter(item => item && item.active !== false)
        .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime())
        .slice(0, 20);

    sendJson(
        res,
        200,
        {
            ok: true,
            banner: {
                enabled: Boolean(banner.enabled && banner.url),
                url: banner.url || '',
                type: inferBannerType(banner.url, banner.type)
            },
            announcements: activeAnnouncements
        },
        { 'Cache-Control': 'no-store' }
    );
}

/* ============================================================
   ADMIN SITE CONFIG
============================================================ */

async function requireAdmin(req, res, config) {
    if (!isAuthenticated(req, config)) {
        sendError(res, 401, 'Unauthorized.');
        return false;
    }

    return true;
}

async function actionSiteAdmin(req, res, config) {
    if (!(await requireAdmin(req, res, config))) return;

    const banner = await getBanner(config);
    const announcements = await getAnnouncements(config);

    announcements.sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());

    sendJson(res, 200, {
        ok: true,
        banner,
        announcements
    }, { 'Cache-Control': 'no-store' });
}

async function actionBannerSave(req, res, config) {
    if (!(await requireAdmin(req, res, config))) return;

    const body = await readBody(req);
    const url = cleanText(body.url, 2000);
    const type = ['auto', 'image', 'video'].includes(String(body.type || 'auto').toLowerCase())
        ? String(body.type || 'auto').toLowerCase()
        : 'auto';

    if (url && !validHttpUrl(url)) {
        sendError(res, 400, 'URL banner harus menggunakan http:// atau https://.');
        return;
    }

    const banner = {
        enabled: Boolean(body.enabled && url),
        url,
        type,
        updatedAt: new Date().toISOString()
    };

    await saveBanner(config, banner);

    sendJson(res, 200, {
        ok: true,
        message: banner.enabled ? 'Banner berhasil disimpan.' : 'Banner dinonaktifkan.',
        banner
    });
}

async function actionAnnouncementCreate(req, res, config) {
    if (!(await requireAdmin(req, res, config))) return;

    const body = await readBody(req);
    const title = cleanText(body.title, 120);
    const message = cleanText(body.message, 2000);
    const type = ['info', 'update', 'warning'].includes(String(body.type || 'info').toLowerCase())
        ? String(body.type || 'info').toLowerCase()
        : 'info';

    if (title.length < 2) {
        sendError(res, 400, 'Judul pengumuman terlalu pendek.');
        return;
    }

    if (message.length < 2) {
        sendError(res, 400, 'Isi pengumuman wajib diisi.');
        return;
    }

    const announcements = await getAnnouncements(config);
    const now = new Date().toISOString();

    const item = {
        id: `AN${safeId()}`,
        title,
        message,
        type,
        active: body.active !== false,
        createdAt: now,
        updatedAt: now
    };

    announcements.unshift(item);
    await saveAnnouncements(config, announcements);

    sendJson(res, 201, {
        ok: true,
        message: 'Pengumuman berhasil dibuat.',
        announcement: item
    });
}

async function actionAnnouncementStatus(req, res, config) {
    if (!(await requireAdmin(req, res, config))) return;

    const body = await readBody(req);
    const id = cleanText(body.id, 80);
    const active = Boolean(body.active);

    if (!id) {
        sendError(res, 400, 'ID pengumuman tidak ada.');
        return;
    }

    const announcements = await getAnnouncements(config);
    const index = announcements.findIndex(item => item.id === id);

    if (index === -1) {
        sendError(res, 404, 'Pengumuman tidak ditemukan.');
        return;
    }

    announcements[index] = {
        ...announcements[index],
        active,
        updatedAt: new Date().toISOString()
    };

    await saveAnnouncements(config, announcements);

    sendJson(res, 200, {
        ok: true,
        message: active ? 'Pengumuman diaktifkan.' : 'Pengumuman dinonaktifkan.',
        announcement: announcements[index]
    });
}

async function actionAnnouncementDelete(req, res, config) {
    if (!(await requireAdmin(req, res, config))) return;

    const body = await readBody(req);
    const id = cleanText(body.id, 80);

    if (!id) {
        sendError(res, 400, 'ID pengumuman tidak ada.');
        return;
    }

    const announcements = await getAnnouncements(config);
    const index = announcements.findIndex(item => item.id === id);

    if (index === -1) {
        sendError(res, 404, 'Pengumuman tidak ditemukan.');
        return;
    }

    const deleted = announcements.splice(index, 1)[0];
    await saveAnnouncements(config, announcements);

    sendJson(res, 200, {
        ok: true,
        message: 'Pengumuman berhasil dihapus.',
        announcement: deleted
    });
}

/* ============================================================
   COOKIE / SESSION
============================================================ */

function parseCookies(
    req
) {
    const header =
        req.headers.cookie || '';

    const cookies = {};

    header
        .split(';')
        .forEach(part => {
            const index =
                part.indexOf('=');

            if (
                index === -1
            ) {
                return;
            }

            const key =
                part
                    .slice(
                        0,
                        index
                    )
                    .trim();

            const value =
                part
                    .slice(
                        index + 1
                    )
                    .trim();

            cookies[key] =
                value;
        });

    return cookies;
}

function signSession(
    payload,
    secret
) {
    return crypto
        .createHmac(
            'sha256',
            secret
        )
        .update(payload)
        .digest('base64url');
}

function createSession(
    secret
) {
    const expires =
        Math.floor(
            Date.now() / 1000
        ) + SESSION_DURATION;

    const nonce =
        crypto
            .randomBytes(16)
            .toString(
                'base64url'
            );

    const payload =
        `${expires}.${nonce}`;

    const signature =
        signSession(
            payload,
            secret
        );

    const token =
        Buffer
            .from(
                `${payload}.${signature}`
            )
            .toString(
                'base64url'
            );

    return {
        token,
        expires
    };
}

function verifySession(
    token,
    secret
) {
    if (!token) {
        return false;
    }

    let decoded;

    try {
        decoded =
            Buffer
                .from(
                    token,
                    'base64url'
                )
                .toString(
                    'utf8'
                );
    } catch {
        return false;
    }

    const parts =
        decoded.split('.');

    if (
        parts.length !== 3
    ) {
        return false;
    }

    const [
        expiresString,
        nonce,
        signature
    ] = parts;

    const expires =
        Number(
            expiresString
        );

    if (
        !Number.isFinite(
            expires
        )
    ) {
        return false;
    }

    if (
        expires <
        Math.floor(
            Date.now() / 1000
        )
    ) {
        return false;
    }

    if (
        !nonce ||
        !signature
    ) {
        return false;
    }

    const expected =
        signSession(
            `${expires}.${nonce}`,
            secret
        );

    const a =
        Buffer.from(
            signature
        );

    const b =
        Buffer.from(
            expected
        );

    if (
        a.length !==
        b.length
    ) {
        return false;
    }

    return crypto.timingSafeEqual(
        a,
        b
    );
}

function isAuthenticated(
    req,
    config
) {
    const cookies =
        parseCookies(req);

    return verifySession(
        cookies.fx_session,
        config.sessionSecret
    );
}

function sessionCookie(
    token,
    maxAge
) {
    const secure =
        process.env.NODE_ENV ===
        'production'
            ? '; Secure'
            : '';

    return [
        `fx_session=${token}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${maxAge}`,
        secure
    ].join('; ');
}

/* ============================================================
   RESPONSE
============================================================ */

function sendJson(
    res,
    status,
    data,
    headers = {}
) {
    res.statusCode =
        status;

    res.setHeader(
        'Content-Type',
        'application/json; charset=utf-8'
    );

    res.setHeader(
        'X-Content-Type-Options',
        'nosniff'
    );

    Object.entries(
        headers
    ).forEach(
        ([key, value]) => {
            res.setHeader(
                key,
                value
            );
        }
    );

    res.end(
        JSON.stringify(
            data
        )
    );
}

function sendError(
    res,
    status,
    message
) {
    sendJson(
        res,
        status,
        {
            ok: false,
            error: message
        }
    );
}

/* ============================================================
   BODY PARSER
============================================================ */

async function readBody(
    req
) {
    if (
        req.body &&
        typeof req.body ===
            'object'
    ) {
        return req.body;
    }

    return new Promise(
        (resolve, reject) => {
            let raw = '';

            req.on(
                'data',
                chunk => {
                    raw += chunk;

                    if (
                        Buffer.byteLength(
                            raw
                        ) >
                        4 * 1024 * 1024
                    ) {
                        reject(
                            new Error(
                                'Request terlalu besar.'
                            )
                        );

                        req.destroy();
                    }
                }
            );

            req.on(
                'end',
                () => {
                    if (!raw) {
                        resolve({});
                        return;
                    }

                    try {
                        resolve(
                            JSON.parse(
                                raw
                            )
                        );
                    } catch {
                        reject(
                            new Error(
                                'JSON request tidak valid.'
                            )
                        );
                    }
                }
            );

            req.on(
                'error',
                reject
            );
        }
    );
}

/* ============================================================
   CODE VALIDATION
============================================================ */

function validateCodeContent(
    content
) {
    const value =
        String(
            content ?? ''
        );

    const bytes =
        Buffer.byteLength(
            value,
            'utf8'
        );

    if (
        bytes >
        MAX_FILE_SIZE
    ) {
        throw new Error(
            'Ukuran file maksimal 2 MB.'
        );
    }

    return value;
}

/* ============================================================
   ADMIN PASSWORD
============================================================ */

async function loadAdminPasswordHash(
    config
) {
    if (
        process.env
            .ADMIN_PASSWORD_HASH
    ) {
        return process.env
            .ADMIN_PASSWORD_HASH
            .trim();
    }

    const file =
        await getGithubFile(
            config,
            'config/admin.json'
        );

    if (!file) {
        throw new Error(
            'config/admin.json belum dibuat di storage repository.'
        );
    }

    const data =
        parseJsonSafely(
            file.content,
            null
        );

    if (
        !data ||
        typeof data.passwordHash !==
            'string'
    ) {
        throw new Error(
            'passwordHash tidak ditemukan di config/admin.json.'
        );
    }

    return data.passwordHash.trim();
}

/* ============================================================
   PASSWORD VERIFICATION
============================================================ */

function verifyPassword(
    password,
    stored
) {
    if (
        typeof password !==
            'string' ||
        !password ||
        typeof stored !==
            'string' ||
        !stored
    ) {
        return false;
    }

    const hash =
        stored.trim();

    /* BCRYPT */

    if (
        hash.startsWith(
            '$2a$'
        ) ||
        hash.startsWith(
            '$2b$'
        ) ||
        hash.startsWith(
            '$2y$'
        )
    ) {
        try {
            return bcrypt.compareSync(
                password,
                hash
            );
        } catch (error) {
            console.error(
                '[FX AUTH] bcrypt verification error:',
                error
            );

            return false;
        }
    }

    /* SCRYPT LEGACY */

    if (
        !hash.includes(':')
    ) {
        return false;
    }

    const separatorIndex =
        hash.indexOf(':');

    const salt =
        hash.slice(
            0,
            separatorIndex
        );

    const hashHex =
        hash.slice(
            separatorIndex + 1
        );

    if (
        !salt ||
        !hashHex ||
        !/^[a-fA-F0-9]+$/.test(
            hashHex
        )
    ) {
        return false;
    }

    try {
        const expected =
            Buffer.from(
                hashHex,
                'hex'
            );

        if (
            expected.length === 0
        ) {
            return false;
        }

        const actual =
            crypto.scryptSync(
                password,
                salt,
                expected.length
            );

        if (
            actual.length !==
            expected.length
        ) {
            return false;
        }

        return crypto.timingSafeEqual(
            actual,
            expected
        );
    } catch (error) {
        console.error(
            '[FX AUTH] scrypt verification error:',
            error
        );

        return false;
    }
}

/* ============================================================
   PUBLIC POST
============================================================ */

function publicPost(
    post
) {
    return {
        id: post.id,
        title: post.title,
        description:
            post.description,
        filename:
            post.filename,
        language:
            post.language,
        extension:
            post.extension,
        size: post.size,
        createdAt:
            post.createdAt,
        updatedAt:
            post.updatedAt
    };
}

/* ============================================================
   LIST
============================================================ */

async function actionList(
    req,
    res,
    config
) {
    const posts =
        await getIndex(
            config
        );

    const clean =
        posts
            .map(publicPost)
            .sort(
                (a, b) =>
                    new Date(
                        b.updatedAt ||
                        b.createdAt
                    ).getTime() -
                    new Date(
                        a.updatedAt ||
                        a.createdAt
                    ).getTime()
            );

    sendJson(
        res,
        200,
        {
            ok: true,
            count:
                clean.length,
            posts: clean
        },
        {
            'Cache-Control':
                'public, s-maxage=30, stale-while-revalidate=120'
        }
    );
}

/* ============================================================
   GET CODE
============================================================ */

async function actionGet(
    req,
    res,
    config,
    id
) {
    if (!id) {
        sendError(
            res,
            400,
            'ID tidak ada.'
        );

        return;
    }

    const posts =
        await getIndex(
            config
        );

    const post =
        posts.find(
            item =>
                item.id === id
        );

    if (!post) {
        sendError(
            res,
            404,
            'Kode tidak ditemukan.'
        );

        return;
    }

    const file =
        await getGithubFile(
            config,
            post.storagePath
        );

    if (!file) {
        sendError(
            res,
            404,
            'File kode tidak ditemukan.'
        );

        return;
    }

    sendJson(
        res,
        200,
        {
            ok: true,
            post:
                publicPost(
                    post
                ),
            code:
                file.content
        },
        {
            'Cache-Control':
                'public, s-maxage=30, stale-while-revalidate=120'
        }
    );
}

/* ============================================================
   LOGIN
============================================================ */

async function actionLogin(
    req,
    res,
    config
) {
    const body =
        await readBody(req);

    const password =
        String(
            body.password || ''
        );

    if (!password) {
        sendError(
            res,
            400,
            'Password wajib diisi.'
        );

        return;
    }

    const storedHash =
        await loadAdminPasswordHash(
            config
        );

    const valid =
        verifyPassword(
            password,
            storedHash
        );

    if (!valid) {
        sendError(
            res,
            401,
            'Password salah.'
        );

        return;
    }

    const session =
        createSession(
            config.sessionSecret
        );

    res.setHeader(
        'Set-Cookie',
        sessionCookie(
            session.token,
            SESSION_DURATION
        )
    );

    sendJson(
        res,
        200,
        {
            ok: true,
            message:
                'Login berhasil.',
            expires:
                session.expires
        }
    );
}

/* ============================================================
   ME
============================================================ */

async function actionMe(
    req,
    res,
    config
) {
    const authenticated =
        isAuthenticated(
            req,
            config
        );

    sendJson(
        res,
        200,
        {
            ok: true,
            authenticated
        }
    );
}

/* ============================================================
   LOGOUT
============================================================ */

async function actionLogout(
    req,
    res
) {
    res.setHeader(
        'Set-Cookie',
        sessionCookie(
            '',
            0
        )
    );

    sendJson(
        res,
        200,
        {
            ok: true
        }
    );
}

/* ============================================================
   UPLOAD
============================================================ */

async function actionUpload(
    req,
    res,
    config
) {
    if (
        !isAuthenticated(
            req,
            config
        )
    ) {
        sendError(
            res,
            401,
            'Unauthorized.'
        );

        return;
    }

    const body =
        await readBody(req);

    const title =
        cleanText(
            body.title,
            140
        );

    const description =
        cleanText(
            body.description,
            500
        );

    const filename =
        safeFilename(
            body.filename
        );

    const code =
        validateCodeContent(
            body.content
        );

    if (!title) {
        sendError(
            res,
            400,
            'Judul wajib diisi.'
        );

        return;
    }

    if (!code.trim()) {
        sendError(
            res,
            400,
            'Isi kode tidak boleh kosong.'
        );

        return;
    }

    const id =
        safeId();

    const extension =
        getExtension(
            filename
        );

    const language =
        detectLanguage(
            filename
        );

    const storagePath =
        `files/${id}.${extension}`;

    const now =
        new Date().toISOString();

    const post = {
        id,
        title,
        description,
        filename,
        language,
        extension,
        size:
            Buffer.byteLength(
                code,
                'utf8'
            ),
        createdAt:
            now,
        updatedAt:
            now,
        storagePath
    };

    await putGithubFile(
        config,
        storagePath,
        code,
        `FX Project: add ${filename}`
    );

    try {
        const posts =
            await getIndex(
                config
            );

        posts.push(
            post
        );

        await saveIndex(
            config,
            posts
        );
    } catch (error) {
        try {
            await deleteGithubFile(
                config,
                storagePath,
                `FX Project: rollback ${filename}`
            );
        } catch {}

        throw error;
    }

    sendJson(
        res,
        201,
        {
            ok: true,
            message:
                'Kode berhasil diupload.',
            post:
                publicPost(
                    post
                )
        }
    );
}

/* ============================================================
   EDIT
============================================================ */

async function actionEdit(
    req,
    res,
    config
) {
    if (
        !isAuthenticated(
            req,
            config
        )
    ) {
        sendError(
            res,
            401,
            'Unauthorized.'
        );

        return;
    }

    const body =
        await readBody(req);

    const id =
        cleanText(
            body.id,
            80
        );

    if (!id) {
        sendError(
            res,
            400,
            'ID tidak ada.'
        );

        return;
    }

    const posts =
        await getIndex(
            config
        );

    const index =
        posts.findIndex(
            item =>
                item.id === id
        );

    if (index === -1) {
        sendError(
            res,
            404,
            'Kode tidak ditemukan.'
        );

        return;
    }

    const current =
        posts[index];

    const title =
        cleanText(
            body.title,
            140
        ) ||
        current.title;

    const description =
        cleanText(
            body.description,
            500
        );

    const filename =
        safeFilename(
            body.filename ||
            current.filename
        );

    const code =
        validateCodeContent(
            body.content
        );

    if (!code.trim()) {
        sendError(
            res,
            400,
            'Isi kode tidak boleh kosong.'
        );

        return;
    }

    const extension =
        getExtension(
            filename
        );

    const language =
        detectLanguage(
            filename
        );

    let storagePath =
        current.storagePath;

    const newPath =
        `files/${id}.${extension}`;

    if (
        newPath !==
        current.storagePath
    ) {
        storagePath =
            newPath;
    }

    await putGithubFile(
        config,
        storagePath,
        code,
        `FX Project: update ${filename}`
    );

    if (
        current.storagePath !==
        storagePath
    ) {
        try {
            await deleteGithubFile(
                config,
                current.storagePath,
                `FX Project: remove old ${current.filename}`
            );
        } catch {}
    }

    const updated = {
        ...current,
        title,
        description,
        filename,
        language,
        extension,
        size:
            Buffer.byteLength(
                code,
                'utf8'
            ),
        updatedAt:
            new Date().toISOString(),
        storagePath
    };

    posts[index] =
        updated;

    await saveIndex(
        config,
        posts
    );

    sendJson(
        res,
        200,
        {
            ok: true,
            message:
                'Kode berhasil diperbarui.',
            post:
                publicPost(
                    updated
                )
        }
    );
}

/* ============================================================
   DELETE CODE
============================================================ */

async function actionDelete(
    req,
    res,
    config
) {
    if (
        !isAuthenticated(
            req,
            config
        )
    ) {
        sendError(
            res,
            401,
            'Unauthorized.'
        );

        return;
    }

    const body =
        await readBody(req);

    const id =
        cleanText(
            body.id,
            80
        );

    if (!id) {
        sendError(
            res,
            400,
            'ID tidak ada.'
        );

        return;
    }

    const posts =
        await getIndex(
            config
        );

    const index =
        posts.findIndex(
            item =>
                item.id === id
        );

    if (index === -1) {
        sendError(
            res,
            404,
            'Kode tidak ditemukan.'
        );

        return;
    }

    const post =
        posts[index];

    await deleteGithubFile(
        config,
        post.storagePath,
        `FX Project: delete ${post.filename}`
    );

    posts.splice(
        index,
        1
    );

    await saveIndex(
        config,
        posts
    );

    sendJson(
        res,
        200,
        {
            ok: true,
            message:
                'Kode berhasil dihapus.'
        }
    );
}

/* ============================================================
   ADMIN LIST
============================================================ */

async function actionAdminList(
    req,
    res,
    config
) {
    if (
        !isAuthenticated(
            req,
            config
        )
    ) {
        sendError(
            res,
            401,
            'Unauthorized.'
        );

        return;
    }

    const posts =
        await getIndex(
            config
        );

    sendJson(
        res,
        200,
        {
            ok: true,
            count:
                posts.length,
            posts
        }
    );
}

/* ============================================================
   CREATE SCRAPE REQUEST
===============================================================
   PUBLIC ENDPOINT

   POST /api?action=request

   Body:
   {
       "name": "Kyuu",
       "request": "Scrape website..."
   }
============================================================ */

async function actionCreateRequest(
    req,
    res,
    config
) {
    const body =
        await readBody(req);

    const name =
        cleanText(
            body.name,
            80
        );

    const request =
        cleanText(
            body.request,
            5000
        );

    if (!name) {
        sendError(
            res,
            400,
            'Nama wajib diisi.'
        );

        return;
    }

    if (
        name.length < 2
    ) {
        sendError(
            res,
            400,
            'Nama terlalu pendek.'
        );

        return;
    }

    if (!request) {
        sendError(
            res,
            400,
            'Request wajib diisi.'
        );

        return;
    }

    if (
        request.length < 5
    ) {
        sendError(
            res,
            400,
            'Request terlalu pendek.'
        );

        return;
    }

    const requests =
        await getRequests(
            config
        );

    const now =
        new Date().toISOString();

    const item = {
        id:
            `RQ${safeId()}`,
        name,
        request,
        status:
            'pending',
        createdAt:
            now,
        updatedAt:
            now
    };

    requests.unshift(
        item
    );

    await saveRequests(
        config,
        requests
    );

    sendJson(
        res,
        201,
        {
            ok: true,
            message:
                'Request berhasil dikirim.',
            request: item
        }
    );
}

/* ============================================================
   ADMIN REQUEST LIST
=============================================================== */

async function actionRequestList(
    req,
    res,
    config
) {
    if (
        !isAuthenticated(
            req,
            config
        )
    ) {
        sendError(
            res,
            401,
            'Unauthorized.'
        );

        return;
    }

    const requests =
        await getRequests(
            config
        );

    const sorted =
        [...requests].sort(
            (a, b) =>
                new Date(
                    b.createdAt
                ).getTime() -
                new Date(
                    a.createdAt
                ).getTime()
        );

    const stats = {
        total:
            sorted.length,
        pending:
            sorted.filter(
                item =>
                    item.status ===
                    'pending'
            ).length,
        processing:
            sorted.filter(
                item =>
                    item.status ===
                    'processing'
            ).length,
        done:
            sorted.filter(
                item =>
                    item.status ===
                    'done'
            ).length,
        rejected:
            sorted.filter(
                item =>
                    item.status ===
                    'rejected'
            ).length
    };

    sendJson(
        res,
        200,
        {
            ok: true,
            count:
                sorted.length,
            stats,
            requests:
                sorted
        },
        {
            'Cache-Control':
                'no-store'
        }
    );
}

/* ============================================================
   ADMIN UPDATE REQUEST STATUS
=============================================================== */

async function actionRequestStatus(
    req,
    res,
    config
) {
    if (
        !isAuthenticated(
            req,
            config
        )
    ) {
        sendError(
            res,
            401,
            'Unauthorized.'
        );

        return;
    }

    const body =
        await readBody(req);

    const id =
        cleanText(
            body.id,
            80
        );

    const status =
        cleanText(
            body.status,
            30
        ).toLowerCase();

    const allowed =
        new Set([
            'pending',
            'processing',
            'done',
            'rejected'
        ]);

    if (!id) {
        sendError(
            res,
            400,
            'ID request tidak ada.'
        );

        return;
    }

    if (
        !allowed.has(
            status
        )
    ) {
        sendError(
            res,
            400,
            'Status request tidak valid.'
        );

        return;
    }

    const requests =
        await getRequests(
            config
        );

    const index =
        requests.findIndex(
            item =>
                item.id === id
        );

    if (
        index === -1
    ) {
        sendError(
            res,
            404,
            'Request tidak ditemukan.'
        );

        return;
    }

    requests[index] = {
        ...requests[index],
        status,
        updatedAt:
            new Date().toISOString()
    };

    await saveRequests(
        config,
        requests
    );

    sendJson(
        res,
        200,
        {
            ok: true,
            message:
                'Status request berhasil diperbarui.',
            request:
                requests[index]
        }
    );
}

/* ============================================================
   ADMIN DELETE REQUEST
=============================================================== */

async function actionRequestDelete(
    req,
    res,
    config
) {
    if (
        !isAuthenticated(
            req,
            config
        )
    ) {
        sendError(
            res,
            401,
            'Unauthorized.'
        );

        return;
    }

    const body =
        await readBody(req);

    const id =
        cleanText(
            body.id,
            80
        );

    if (!id) {
        sendError(
            res,
            400,
            'ID request tidak ada.'
        );

        return;
    }

    const requests =
        await getRequests(
            config
        );

    const index =
        requests.findIndex(
            item =>
                item.id === id
        );

    if (
        index === -1
    ) {
        sendError(
            res,
            404,
            'Request tidak ditemukan.'
        );

        return;
    }

    const deleted =
        requests[index];

    requests.splice(
        index,
        1
    );

    await saveRequests(
        config,
        requests
    );

    sendJson(
        res,
        200,
        {
            ok: true,
            message:
                'Request berhasil dihapus.',
            request:
                deleted
        }
    );
}

/* ============================================================
   ADMIN DELETE ALL REQUESTS
===============================================================
   Tambahan untuk mempermudah admin.
=============================================================== */

async function actionRequestClear(
    req,
    res,
    config
) {
    if (
        !isAuthenticated(
            req,
            config
        )
    ) {
        sendError(
            res,
            401,
            'Unauthorized.'
        );

        return;
    }

    await saveRequests(
        config,
        []
    );

    sendJson(
        res,
        200,
        {
            ok: true,
            message:
                'Semua request berhasil dihapus.'
        }
    );
}

/* ============================================================
   MAIN HANDLER
============================================================ */

module.exports =
    async function handler(
        req,
        res
    ) {
        try {
            const config =
                getConfig();

            const url =
                new URL(
                    req.url,
                    `https://${
                        req.headers.host ||
                        'localhost'
                    }`
                );

            const action =
                url.searchParams.get(
                    'action'
                ) || '';

            const id =
                url.searchParams.get(
                    'id'
                ) || '';

            /* ====================================================
               OPTIONS / CORS
            ==================================================== */

            if (
                req.method ===
                'OPTIONS'
            ) {
                res.statusCode =
                    204;

                res.setHeader(
                    'Access-Control-Allow-Origin',
                    '*'
                );

                res.setHeader(
                    'Access-Control-Allow-Methods',
                    'GET,POST,OPTIONS'
                );

                res.setHeader(
                    'Access-Control-Allow-Headers',
                    'Content-Type'
                );

                res.end();

                return;
            }

            /* ====================================================
               PUBLIC CODE LIST
            ==================================================== */

            if (
                req.method ===
                    'GET' &&
                action ===
                    'list'
            ) {
                await actionList(
                    req,
                    res,
                    config
                );

                return;
            }

            /* ====================================================
               PUBLIC GET CODE
            ==================================================== */

            if (
                req.method ===
                    'GET' &&
                action ===
                    'get'
            ) {
                await actionGet(
                    req,
                    res,
                    config,
                    id
                );

                return;
            }

            /* ====================================================
               SESSION CHECK
            ==================================================== */

            if (
                req.method ===
                    'GET' &&
                action ===
                    'me'
            ) {
                await actionMe(
                    req,
                    res,
                    config
                );

                return;
            }

            /* ====================================================
               ADMIN CODE LIST
            ==================================================== */

            if (
                req.method ===
                    'GET' &&
                action ===
                    'admin-list'
            ) {
                await actionAdminList(
                    req,
                    res,
                    config
                );

                return;
            }

            /* ====================================================
               ADMIN REQUEST LIST
            ==================================================== */

            if (
                req.method ===
                    'GET' &&
                action ===
                    'requests'
            ) {
                await actionRequestList(
                    req,
                    res,
                    config
                );

                return;
            }

            /* ====================================================
               PUBLIC SITE CONFIG
            ==================================================== */

            if (
                req.method === 'GET' &&
                action === 'site'
            ) {
                await actionSite(req, res, config);
                return;
            }

            /* ====================================================
               ADMIN SITE CONFIG
            ==================================================== */

            if (
                req.method === 'GET' &&
                action === 'site-admin'
            ) {
                await actionSiteAdmin(req, res, config);
                return;
            }

            if (
                req.method === 'POST' &&
                action === 'banner-save'
            ) {
                await actionBannerSave(req, res, config);
                return;
            }

            if (
                req.method === 'POST' &&
                action === 'announcement-create'
            ) {
                await actionAnnouncementCreate(req, res, config);
                return;
            }

            if (
                req.method === 'POST' &&
                action === 'announcement-status'
            ) {
                await actionAnnouncementStatus(req, res, config);
                return;
            }

            if (
                req.method === 'POST' &&
                action === 'announcement-delete'
            ) {
                await actionAnnouncementDelete(req, res, config);
                return;
            }

            /* ====================================================
               LOGIN
            ==================================================== */

            if (
                req.method ===
                    'POST' &&
                action ===
                    'login'
            ) {
                await actionLogin(
                    req,
                    res,
                    config
                );

                return;
            }

            /* ====================================================
               LOGOUT
            ==================================================== */

            if (
                req.method ===
                    'POST' &&
                action ===
                    'logout'
            ) {
                await actionLogout(
                    req,
                    res
                );

                return;
            }

            /* ====================================================
               UPLOAD
            ==================================================== */

            if (
                req.method ===
                    'POST' &&
                action ===
                    'upload'
            ) {
                await actionUpload(
                    req,
                    res,
                    config
                );

                return;
            }

            /* ====================================================
               EDIT
            ==================================================== */

            if (
                req.method ===
                    'POST' &&
                action ===
                    'edit'
            ) {
                await actionEdit(
                    req,
                    res,
                    config
                );

                return;
            }

            /* ====================================================
               DELETE CODE
            ==================================================== */

            if (
                req.method ===
                    'POST' &&
                action ===
                    'delete'
            ) {
                await actionDelete(
                    req,
                    res,
                    config
                );

                return;
            }

            /* ====================================================
               PUBLIC CREATE REQUEST
            ==================================================== */

            if (
                req.method ===
                    'POST' &&
                action ===
                    'request'
            ) {
                await actionCreateRequest(
                    req,
                    res,
                    config
                );

                return;
            }

            /* ====================================================
               ADMIN UPDATE REQUEST STATUS
            ==================================================== */

            if (
                req.method ===
                    'POST' &&
                action ===
                    'request-status'
            ) {
                await actionRequestStatus(
                    req,
                    res,
                    config
                );

                return;
            }

            /* ====================================================
               ADMIN DELETE REQUEST
            ==================================================== */

            if (
                req.method ===
                    'POST' &&
                action ===
                    'request-delete'
            ) {
                await actionRequestDelete(
                    req,
                    res,
                    config
                );

                return;
            }

            /* ====================================================
               ADMIN CLEAR REQUESTS
            ==================================================== */

            if (
                req.method ===
                    'POST' &&
                action ===
                    'request-clear'
            ) {
                await actionRequestClear(
                    req,
                    res,
                    config
                );

                return;
            }

            /* ====================================================
               NOT FOUND
            ==================================================== */

            sendError(
                res,
                404,
                'API endpoint tidak ditemukan.'
            );
        } catch (error) {
            console.error(
                '[FX API ERROR]',
                error
            );

            sendError(
                res,
                500,
                error.message ||
                'Internal Server Error'
            );
        }
    };