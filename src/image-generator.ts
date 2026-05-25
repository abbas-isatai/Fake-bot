import { createCanvas, loadImage, GlobalFonts, type SKRSContext2D } from "@napi-rs/canvas";

import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONTS = path.resolve(__dirname, "../assets/fonts");
GlobalFonts.registerFromPath(path.join(FONTS, "ggsans-400-normal.woff2"), "gg sans");
GlobalFonts.registerFromPath(path.join(FONTS, "ggsans-500-medium.woff2"), "gg sans");
GlobalFonts.registerFromPath(path.join(FONTS, "ggsans-700-bold.woff2"), "gg sans");

// ─── Colors ────────────────────────────────────────────────────────────────
const BG           = "#313338";
const TEXT_PRIMARY = "#dbdee1";
const TEXT_MUTED   = "#80848e";
const BADGE_BG     = "#404249";
const REACTION_BG  = "#2b2d31";
const REACTION_BDR = "#4e5058";
const BLURPLE      = "#5865f2";
const REPLY_LINE   = "#4e5058";

// ─── Layout constants ──────────────────────────────────────────────────────
const S          = 2;       // 2× retina
const CANVAS_W   = 520 * S;
const AVATAR_X   = 16  * S;
const AVATAR_SZ  = 46  * S;
const CONTENT_X  = 80  * S;
const LINE_H     = 22  * S;
const PAD_TOP    = 16  * S;
const PAD_BOT    = 20  * S;
const TOP_ROW_H  = 24  * S;
const BADGE_H    = 18  * S;
const BADGE_ICON = 12  * S;
const BADGE_PX   = 6   * S;
const BADGE_R    = 4   * S;

type Ctx = SKRSContext2D;

// ─── Types ─────────────────────────────────────────────────────────────────
export interface Reaction { emoji: string; count: number; reacted?: boolean; }
export interface ReplyTo  {
  username: string; avatarUrl: string | null;
  message: string;  usernameColor?: string;
}
export interface MessageOptions {
  username: string; discriminator?: string; avatarUrl: string | null; message: string;
  usernameColor?: string; roleName?: string; roleColor?: string;
  clanTag?: string; clanBadgeUrl?: string;
  edited?: boolean; reactions?: Reaction[]; replyTo?: ReplyTo;
  platform?: "mobile" | "desktop"; // kept for compat, no visual effect
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function wrapText(ctx: Ctx, text: string, maxW: number, font: string): string[] {
  ctx.font = font;
  const lines: string[] = [];
  let cur = "";
  for (const word of text.split(" ")) {
    const test = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = word; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

function timestamp(): string {
  const d = new Date();
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes().toString().padStart(2, "0");
  return `Today at ${h}:${m} ${d.getHours() >= 12 ? "PM" : "AM"}`;
}

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
}

// ─── Avatar ────────────────────────────────────────────────────────────────
function defaultAvatar(ctx: Ctx, cx: number, cy: number, r: number, name: string) {
  const palette = ["#5865f2", "#57f287", "#fee75c", "#ed4245", "#eb459e"];
  ctx.fillStyle = palette[name.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % palette.length];
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.font = `bold ${r}px gg sans`; ctx.fillStyle = "#fff";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(name[0]?.toUpperCase() ?? "?", cx, cy);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
}

async function drawAvatar(ctx: Ctx, x: number, y: number, sz: number, url: string | null, name: string) {
  const cx = x + sz / 2, cy = y + sz / 2;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, sz / 2, 0, Math.PI * 2); ctx.clip();
  if (url) { try { ctx.drawImage(await loadImage(url), x, y, sz, sz); } catch { defaultAvatar(ctx, cx, cy, sz / 2, name); } }
  else defaultAvatar(ctx, cx, cy, sz / 2, name);
  ctx.restore();
}

// ─── Badge ─────────────────────────────────────────────────────────────────
async function drawBadge(ctx: Ctx, x: number, baseY: number, text: string, color: string, iconUrl?: string): Promise<number> {
  ctx.font = `bold ${11 * S}px gg sans`;
  const iconW = iconUrl ? BADGE_ICON + 4 * S : 0;
  const bW = BADGE_PX + iconW + ctx.measureText(text).width + BADGE_PX;
  const bY = baseY - BADGE_H + 3 * S;
  rr(ctx, x, bY, bW, BADGE_H, BADGE_R); ctx.fillStyle = BADGE_BG; ctx.fill();
  let tx = x + BADGE_PX;
  if (iconUrl) {
    try { ctx.drawImage(await loadImage(iconUrl), tx, bY + (BADGE_H - BADGE_ICON) / 2, BADGE_ICON, BADGE_ICON); } catch {}
    tx += BADGE_ICON + 4 * S;
  }
  ctx.fillStyle = color; ctx.fillText(text, tx, bY + BADGE_H - 4 * S);
  return bW + 6 * S;
}

// ─── Reactions ─────────────────────────────────────────────────────────────
function drawReactions(ctx: Ctx, reactions: Reaction[], x: number, y: number) {
  const pH = 24 * S, pp = 8 * S, gap = 4 * S;
  ctx.font = `${13 * S}px gg sans`;
  let rx = x;
  const ry = y + 4 * S;
  for (const r of reactions) {
    const label = `${r.emoji} ${r.count}`;
    const pW = pp + ctx.measureText(label).width + pp;
    rr(ctx, rx, ry, pW, pH, pH / 2);
    ctx.fillStyle = r.reacted ? "#3c3f8f" : REACTION_BG; ctx.fill();
    ctx.strokeStyle = r.reacted ? BLURPLE : REACTION_BDR; ctx.lineWidth = S; ctx.stroke();
    ctx.fillStyle = r.reacted ? "#c9cdfb" : TEXT_PRIMARY;
    ctx.fillText(label, rx + pp, ry + pH - 7 * S);
    rx += pW + gap;
  }
}

// ─── Reply ─────────────────────────────────────────────────────────────────
async function drawReply(ctx: Ctx, reply: ReplyTo, x: number, y: number) {
  const lX = x - 2 * S, lY = y + 3 * S;
  rr(ctx, lX, lY, 2 * S, 18 * S, S); ctx.fillStyle = REPLY_LINE; ctx.fill();
  const avSz = 16 * S, avX = lX + 2 * S + 6 * S;
  await drawAvatar(ctx, avX, lY + S, avSz, reply.avatarUrl, reply.username);
  const nX = avX + avSz + 4 * S, nY = lY + 13 * S;
  ctx.font = `bold ${11 * S}px gg sans`;
  ctx.fillStyle = (reply.usernameColor && reply.usernameColor !== "#000000") ? reply.usernameColor : "#b5bac1";
  ctx.fillText(reply.username, nX, nY);
  const qX = nX + ctx.measureText(reply.username).width + 6 * S;
  const qMax = CANVAS_W - qX - 16 * S;
  ctx.font = `${11 * S}px gg sans`; ctx.fillStyle = TEXT_MUTED;
  let trunc = reply.message;
  while (ctx.measureText(trunc + "…").width > qMax && trunc.length > 0) trunc = trunc.slice(0, -1);
  ctx.fillText(trunc !== reply.message ? trunc + "…" : trunc, qX, nY);
}

// ─── Main export ───────────────────────────────────────────────────────────
export async function generateFakeMessage(opts: MessageOptions): Promise<Buffer> {
  const fontMsg = `${16 * S}px gg sans`;
  const maxTextW = CANVAS_W - CONTENT_X - 16 * S;

  // Measure height — (edited) is inline so adds no extra line height
  const tmp = createCanvas(CANVAS_W, 100).getContext("2d");
  const lines = wrapText(tmp, opts.message, maxTextW, fontMsg);
  const replyH = opts.replyTo           ? 24 * S : 0;
  const reactH = opts.reactions?.length ? 34 * S : 0;
  const canvasH = Math.max(
    PAD_TOP + replyH + TOP_ROW_H + lines.length * LINE_H + reactH + PAD_BOT,
    AVATAR_SZ + PAD_TOP + PAD_BOT
  );

  const canvas = createCanvas(CANVAS_W, canvasH);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = BG; ctx.fillRect(0, 0, CANVAS_W, canvasH);

  let curY = PAD_TOP;

  // Reply bar
  if (opts.replyTo) {
    await drawReply(ctx, opts.replyTo, CONTENT_X, curY);
    curY += replyH;
  }

  // Avatar
  await drawAvatar(ctx, AVATAR_X, curY, AVATAR_SZ, opts.avatarUrl, opts.username);

  // Name row
  const nameY = curY + 18 * S;
  let cx = CONTENT_X;

  ctx.font = `bold ${16 * S}px gg sans`;
  ctx.fillStyle = (opts.usernameColor && opts.usernameColor !== "#000000") ? opts.usernameColor : "#f2f3f5";
  ctx.fillText(opts.username, cx, nameY);
  cx += ctx.measureText(opts.username).width + 6 * S;

  // Discriminator / tag
  if (opts.discriminator && opts.discriminator !== "0") {
    ctx.font = `${13 * S}px gg sans`; ctx.fillStyle = TEXT_MUTED;
    ctx.fillText(`#${opts.discriminator}`, cx, nameY);
    cx += ctx.measureText(`#${opts.discriminator}`).width + 6 * S;
  }

  // Clan or role badge
  if (opts.clanTag) {
    cx += await drawBadge(ctx, cx, nameY, opts.clanTag, "#ffffff", opts.clanBadgeUrl);
  } else if (opts.roleName) {
    const tc = (opts.roleColor && opts.roleColor !== "#000000") ? opts.roleColor : "#ffffff";
    cx += await drawBadge(ctx, cx, nameY, opts.roleName, tc);
  }

  // Timestamp
  ctx.font = `${12 * S}px gg sans`; ctx.fillStyle = TEXT_MUTED;
  ctx.fillText(timestamp(), cx + 2 * S, nameY - S);
  curY += TOP_ROW_H;

  // Message lines
  ctx.font = fontMsg; ctx.fillStyle = TEXT_PRIMARY;
  for (const line of lines) {
    ctx.fillText(line, CONTENT_X, curY + 18 * S);
    curY += LINE_H;
  }

  // "(edited)" inline — drawn on the same baseline as the last message line
  if (opts.edited) {
    const lastLine = lines[lines.length - 1] ?? "";
    ctx.font = fontMsg;
    const lastLineEndX = CONTENT_X + ctx.measureText(lastLine).width + 4 * S;
    const lastLineBaselineY = curY - LINE_H + 18 * S;
    ctx.font = `${11 * S}px gg sans`; ctx.fillStyle = TEXT_MUTED;
    ctx.fillText("(edited)", lastLineEndX, lastLineBaselineY);
  }

  // Reactions
  if (opts.reactions?.length) drawReactions(ctx, opts.reactions, CONTENT_X, curY);

  return canvas.toBuffer("image/png");
}
