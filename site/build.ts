import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked, type Token, type Tokens } from "marked";

const SITE_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(SITE_DIR, "..");
const SPEC_DIR = join(ROOT_DIR, "spec");
const DIST_DIR = join(SITE_DIR, "dist");

const ORIGIN = "https://talk.input.so";
const BASE_PATH = "";
const SITE_NAME = "Agent Talk";
const GITHUB_URL = "https://github.com/input-systems/agent-talk";
const INPUT_URL = "https://www.input.so";
const WEBSITE_URL = "https://www.input.so/agent-talk";

const CACHE_HTML = "public, max-age=300, must-revalidate";
const CACHE_JSON = "public, max-age=3600";
const CACHE_IMMUTABLE = "public, max-age=31536000, immutable";

const DESCRIPTION_MAX_LENGTH = 160;

// the spec is private until launch: anything but an explicit "0" keeps it out of search engines
const NOINDEX = process.env.AGENT_TALK_SITE_NOINDEX !== "0";

type SpecPage = {
    source: string;
    path: string;
    fallbackDescription: string;
    withToc: boolean;
};

type FileFolder = {
    source: string;
    path: string;
    title: string;
    intro: string;
    contentType: string;
};

type Heading = {
    depth: number;
    id: string;
    text: string;
};

type LexedPage = {
    page: SpecPage;
    tokens: Token[];
    headingIds: Map<Tokens.Heading, string>;
    headings: Heading[];
    links: string[];
};

type ManifestEntry = {
    path: string;
    contentType: string;
    cacheControl: string;
};

type NavItem = {
    label: string;
    href: string;
};

const SPEC_PAGES: SpecPage[] = [
    {
        source: "agent-talk.md",
        path: `${BASE_PATH}/`,
        fallbackDescription: "Agent Talk is an open protocol for people's agents to talk beside their email.",
        withToc: true,
    },
    {
        source: "a2a-extension.md",
        path: `${BASE_PATH}/v1/`,
        fallbackDescription: "The Agent Talk extension for A2A.",
        withToc: false,
    },
];

const FILE_FOLDERS: FileFolder[] = [
    {
        source: "schemas",
        path: `${BASE_PATH}/v1/schemas/`,
        title: "Schemas",
        intro: "JSON Schemas for Agent Talk v1 objects.",
        contentType: "application/schema+json",
    },
    {
        source: "vectors",
        path: `${BASE_PATH}/v1/vectors/`,
        title: "Test vectors",
        intro: "Test vectors for checking an Agent Talk v1 implementation.",
        contentType: "application/json",
    },
];

const NAV_ITEMS: NavItem[] = [
    { label: "Website", href: WEBSITE_URL },
    { label: "Protocol", href: `${BASE_PATH}/` },
    { label: "A2A extension", href: `${BASE_PATH}/v1/` },
    { label: "Schemas", href: `${BASE_PATH}/v1/schemas/` },
    { label: "Test vectors", href: `${BASE_PATH}/v1/vectors/` },
    { label: "GitHub", href: GITHUB_URL },
];

const manifest: ManifestEntry[] = [];
const warnings: string[] = [];

function escapeHtml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function plainText(tokens: Token[]): string {
    return tokens
        .map((token) => {
            if ("tokens" in token && Array.isArray(token.tokens)) {
                return plainText(token.tokens);
            }
            return "text" in token && typeof token.text === "string" ? token.text : "";
        })
        .join("");
}

// numbered headings ("9.2 Delivery", "A.1 Examples") take their number as id so links survive retitling
function headingSlug(text: string): string {
    const numbered = /^(\d+(?:\.\d+)*|[A-Z](?:\.\d+)+)\.?\s/.exec(text);
    const base = numbered?.[1] ?? text;
    return (
        base
            .toLowerCase()
            .normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "") || "section"
    );
}

function sourceToPath(source: string): string | undefined {
    const normalized = posix.normalize(source).replace(/^(\.\.\/)*(spec\/)?/, "");
    const page = SPEC_PAGES.find((specPage) => specPage.source === normalized);
    if (page) {
        return page.path;
    }
    const folder = FILE_FOLDERS.find((fileFolder) => normalized === fileFolder.source || normalized.startsWith(`${fileFolder.source}/`));
    if (folder) {
        return `${folder.path}${normalized.slice(folder.source.length + 1)}`;
    }
    return undefined;
}

function rewriteHref(href: string, page: SpecPage): string {
    if (href.startsWith("#") || href.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(href)) {
        return href;
    }
    const [source = "", fragment] = href.split("#", 2);
    const path = sourceToPath(source);
    if (!path) {
        warnings.push(`${page.source}: unknown relative link "${href}"`);
        return href;
    }
    return fragment === undefined ? path : `${path}#${fragment}`;
}

function lexPage(page: SpecPage, markdown: string): LexedPage {
    const marked = new Marked({ gfm: true });
    const tokens = marked.lexer(markdown);
    const headingIds = new Map<Tokens.Heading, string>();
    const headings: Heading[] = [];
    const links: string[] = [];
    const usedIds = new Set<string>();

    void marked.walkTokens(tokens, (token) => {
        if (token.type === "link") {
            const link = token as Tokens.Link;
            link.href = rewriteHref(link.href, page);
            links.push(link.href);
        }
        if (token.type === "heading") {
            const heading = token as Tokens.Heading;
            const text = plainText(heading.tokens).trim();
            let id = headingSlug(text);
            for (let suffix = 2; usedIds.has(id); suffix += 1) {
                id = `${headingSlug(text)}-${suffix}`;
            }
            usedIds.add(id);
            headingIds.set(heading, id);
            headings.push({ depth: heading.depth, id, text });
        }
    });

    return { page, tokens, headingIds, headings, links };
}

function renderMarkdown(lexed: LexedPage): string {
    const marked = new Marked({ gfm: true });
    marked.use({
        renderer: {
            heading(token) {
                const id = lexed.headingIds.get(token) ?? headingSlug(plainText(token.tokens));
                const content = this.parser.parseInline(token.tokens);
                return `<h${token.depth} id="${escapeHtml(id)}">${content}<a class="anchor" href="#${escapeHtml(id)}" aria-label="Link to this section">#</a></h${token.depth}>\n`;
            },
        },
    });
    const html = marked.parser(lexed.tokens);
    return html.replaceAll("<table>", '<div class="table-wrap"><table>').replaceAll("</table>", "</table></div>");
}

function pageDescription(lexed: LexedPage): string {
    const paragraph = lexed.tokens.find((token): token is Tokens.Paragraph => token.type === "paragraph");
    const text = paragraph ? plainText(paragraph.tokens).replace(/\s+/g, " ").trim() : "";
    if (!text) {
        return lexed.page.fallbackDescription;
    }
    if (text.length <= DESCRIPTION_MAX_LENGTH) {
        return text;
    }
    const cut = text.slice(0, DESCRIPTION_MAX_LENGTH - 1);
    return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:.]$/, "")}…`;
}

function renderToc(headings: Heading[]): string {
    const groups: { heading: Heading; children: Heading[] }[] = [];
    for (const heading of headings) {
        const parent = groups.at(-1);
        if (heading.depth === 3 && parent) {
            parent.children.push(heading);
        } else if (heading.depth === 2 || heading.depth === 3) {
            groups.push({ heading, children: [] });
        }
    }
    if (groups.length === 0) {
        return "";
    }
    const tocLink = (heading: Heading) => `<a href="#${escapeHtml(heading.id)}">${escapeHtml(heading.text)}</a>`;
    const tocItems = groups.map(({ heading, children }) => {
        const childItems = children.map((child) => `<li>${tocLink(child)}</li>`);
        const childList = childItems.length > 0 ? `<ol>${childItems.join("")}</ol>` : "";
        return `<li>${tocLink(heading)}${childList}</li>`;
    });
    return `<nav class="toc" aria-labelledby="toc-title"><h2 id="toc-title">Contents</h2><ol>${tocItems.join("")}</ol></nav>`;
}

function renderNav(currentPath: string): string {
    const navItemLinks = NAV_ITEMS.map((item) => {
        const current = item.href === currentPath ? ' aria-current="page"' : "";
        return `<a href="${escapeHtml(item.href)}"${current}>${escapeHtml(item.label)}</a>`;
    });
    return navItemLinks.join("");
}

function renderTemplate(template: string, values: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
        const value = values[key];
        if (value === undefined) {
            throw new Error(`site/template.html uses unknown placeholder {{${key}}}`);
        }
        return value;
    });
}

function jsonLd(title: string, description: string, url: string): string {
    const data = {
        "@context": "https://schema.org",
        "@type": "TechArticle",
        headline: title,
        description,
        url,
        inLanguage: "en",
        isPartOf: { "@type": "WebSite", name: SITE_NAME, url: `${ORIGIN}${BASE_PATH}/` },
        author: { "@type": "Organization", name: "Input", url: INPUT_URL },
        publisher: { "@type": "Organization", name: "Input", url: INPUT_URL },
    };
    return `<script type="application/ld+json">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script>`;
}

type HtmlPage = {
    path: string;
    title: string;
    description: string;
    content: string;
    toc: string;
    article: boolean;
};

async function writeOutput(path: string, body: string | Buffer, contentType: string, cacheControl: string): Promise<void> {
    const relativePath = path.replace(/^\//, "");
    const target = join(DIST_DIR, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
    manifest.push({ path: relativePath, contentType, cacheControl });
}

async function writeHtmlPage(template: string, stylesheetHref: string, page: HtmlPage): Promise<void> {
    const url = `${ORIGIN}${page.path}`;
    const fullTitle = page.title === SITE_NAME ? SITE_NAME : `${page.title} · ${SITE_NAME}`;
    const html = renderTemplate(template, {
        title: escapeHtml(fullTitle),
        description: escapeHtml(page.description),
        canonical: escapeHtml(url),
        robots: NOINDEX ? "noindex, nofollow" : "index, follow",
        ogType: page.article ? "article" : "website",
        siteName: SITE_NAME,
        jsonLd: page.article ? jsonLd(page.title, page.description, url) : "",
        stylesheet: escapeHtml(stylesheetHref),
        home: `${BASE_PATH}/`,
        inputUrl: INPUT_URL,
        nav: renderNav(page.path),
        toc: page.toc,
        content: page.content,
    });
    await writeOutput(`${page.path}index.html`, html, "text/html; charset=utf-8", CACHE_HTML);
}

async function listJsonFiles(directory: string): Promise<string[]> {
    if (!existsSync(directory)) {
        return [];
    }
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name)
        .sort();
}

async function readJsonTitle(file: string): Promise<string> {
    try {
        const data: unknown = JSON.parse(await readFile(file, "utf8"));
        if (data && typeof data === "object") {
            const record = data as Record<string, unknown>;
            const title = record.title ?? record.description;
            return typeof title === "string" ? title : "";
        }
    } catch {
        warnings.push(`${file}: not valid JSON`);
    }
    return "";
}

async function buildFileFolder(template: string, stylesheetHref: string, folder: FileFolder): Promise<void> {
    const sourceDir = join(SPEC_DIR, folder.source);
    const files = await listJsonFiles(sourceDir);
    const fileItems: string[] = [];
    for (const file of files) {
        const body = await readFile(join(sourceDir, file));
        await writeOutput(`${folder.path}${file}`, body, folder.contentType, CACHE_JSON);
        const title = await readJsonTitle(join(sourceDir, file));
        const titleHtml = title ? ` <span class="file-title">${escapeHtml(title)}</span>` : "";
        fileItems.push(`<li><a href="${escapeHtml(`${folder.path}${file}`)}"><code>${escapeHtml(file)}</code></a>${titleHtml}</li>`);
    }
    const list = fileItems.length > 0 ? `<ul class="files">${fileItems.join("")}</ul>` : "<p>Nothing published yet.</p>";
    await writeHtmlPage(template, stylesheetHref, {
        path: folder.path,
        title: folder.title,
        description: folder.intro,
        content: `<h1>${escapeHtml(folder.title)}</h1><p>${escapeHtml(folder.intro)}</p>${list}`,
        toc: "",
        article: false,
    });
}

function checkLinks(lexedPages: LexedPage[]): void {
    const idsByPath = new Map(lexedPages.map((lexed) => [lexed.page.path, new Set(lexed.headings.map((heading) => heading.id))]));
    for (const lexed of lexedPages) {
        for (const link of lexed.links) {
            const [path = "", fragment] = link.split("#", 2);
            const folder = FILE_FOLDERS.find((fileFolder) => path.startsWith(fileFolder.path) && path !== fileFolder.path);
            if (folder && !existsSync(join(SPEC_DIR, folder.source, path.slice(folder.path.length)))) {
                warnings.push(`${lexed.page.source}: link "${link}" points to a missing file`);
            }
            if (fragment === undefined) {
                continue;
            }
            const ids = idsByPath.get(path || lexed.page.path);
            if (ids && !ids.has(fragment)) {
                warnings.push(`${lexed.page.source}: link "${link}" points to a missing heading`);
            }
        }
    }
}

function renderSitemap(): string {
    const urls = SPEC_PAGES.map((page) => `  <url><loc>${escapeHtml(`${ORIGIN}${page.path}`)}</loc></url>`);
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

async function build(): Promise<void> {
    await rm(DIST_DIR, { recursive: true, force: true });

    const template = await readFile(join(SITE_DIR, "template.html"), "utf8");
    const stylesheet = await readFile(join(SITE_DIR, "style.css"));
    const stylesheetHash = createHash("sha256").update(stylesheet).digest("hex").slice(0, 10);
    const stylesheetHref = `${BASE_PATH}/style.${stylesheetHash}.css`;
    await writeOutput(stylesheetHref, stylesheet, "text/css; charset=utf-8", CACHE_IMMUTABLE);

    const lexedPages: LexedPage[] = [];
    for (const page of SPEC_PAGES) {
        const markdown = await readFile(join(SPEC_DIR, page.source), "utf8");
        lexedPages.push(lexPage(page, markdown));
    }
    checkLinks(lexedPages);

    for (const lexed of lexedPages) {
        const title = lexed.headings.find((heading) => heading.depth === 1)?.text ?? SITE_NAME;
        await writeHtmlPage(template, stylesheetHref, {
            path: lexed.page.path,
            title,
            description: pageDescription(lexed),
            content: renderMarkdown(lexed),
            toc: lexed.page.withToc ? renderToc(lexed.headings) : "",
            article: true,
        });
    }

    for (const folder of FILE_FOLDERS) {
        await buildFileFolder(template, stylesheetHref, folder);
    }

    await writeOutput(`${BASE_PATH}/sitemap.xml`, renderSitemap(), "application/xml; charset=utf-8", CACHE_HTML);
    await writeFile(join(DIST_DIR, "manifest.json"), `${JSON.stringify({ noindex: NOINDEX, files: manifest }, null, 4)}\n`);

    for (const warning of warnings) {
        console.warn(`warning: ${warning}`);
    }
    console.log(`site: wrote ${manifest.length} files to site/dist (${NOINDEX ? "noindex" : "indexable"})`);
}

await build();
