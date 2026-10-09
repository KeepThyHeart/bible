/** Default CSS: every rule is in @layer vh and wrapped in :where(), so any site rule wins without !important. */
export const css = (P: string) => `@layer vh{
:where(.${P}ref){cursor:pointer;text-decoration:underline dotted;text-underline-offset:.2em;color:var(--vh-link,inherit)}
:where(button.${P}ref){all:unset;display:inline;cursor:pointer;text-decoration:underline dotted;text-underline-offset:.2em;color:var(--vh-link,inherit);font:inherit}
:where(.${P}ref:focus-visible){outline:2px solid var(--vh-accent,#1a5fb4);outline-offset:2px}
:where(.${P}pop){--vh-bg:#fff;--vh-fg:#1c1c1e;--vh-muted:#5c5c63;--vh-accent:#1a5fb4;--vh-border:#c9c9d0;--vh-words:#b3261e;
position:fixed;inset:auto;margin:0;z-index:2147483000;box-sizing:border-box;width:max-content;max-width:min(var(--vh-max-width,26rem),calc(100vw - 16px));max-height:60vh;overflow:auto;
padding:.6em .8em;background:var(--vh-bg);color:var(--vh-fg);border:1px solid var(--vh-border);border-radius:var(--vh-radius,8px);
box-shadow:var(--vh-shadow,0 6px 24px rgba(0,0,0,.18));font:var(--vh-font-size,15px)/var(--vh-line-height,1.5) var(--vh-font,Georgia,'Times New Roman',serif);
text-align:start;transition:opacity .12s}
:where(.${P}pop:not(.${P}pop--open)){opacity:0;pointer-events:none}
:where(.${P}pop.${P}dark){--vh-bg:#1f2023;--vh-fg:#ececf0;--vh-muted:#a6a6b0;--vh-accent:#8ab4f8;--vh-border:#44454c;--vh-words:#ff8a80}
@media (prefers-color-scheme:dark){:where(.${P}pop:not(.${P}light,.${P}dark)){--vh-bg:#1f2023;--vh-fg:#ececf0;--vh-muted:#a6a6b0;--vh-accent:#8ab4f8;--vh-border:#44454c;--vh-words:#ff8a80}}
@media (prefers-reduced-motion:reduce){:where(.${P}pop){transition:none}}
:where(.${P}pop__head){display:flex;gap:.4em;align-items:baseline;margin-block-end:.3em}
:where(.${P}pop__ref){font-weight:700}
:where(.${P}pop__ver){color:var(--vh-muted);font-size:.8em;flex:1}
:where(.${P}pop__close){all:unset;cursor:pointer;color:var(--vh-muted);font-size:1.3em;line-height:1;padding:0 .2em;margin-inline-start:auto}
:where(.${P}pop__close:focus-visible,.${P}pop__link:focus-visible){outline:2px solid var(--vh-accent);outline-offset:2px}
:where(.${P}pop__status){color:var(--vh-muted);font-style:italic}
:where(.${P}pop__foot){margin-block-start:.4em;font-size:.8em;color:var(--vh-muted)}
:where(.${P}pop__link){color:var(--vh-accent)}
:where(.${P}v__num){font-size:.7em;color:var(--vh-muted);margin-inline-end:.25em;font-weight:700}
:where(.${P}v--ctx){opacity:.6}
:where(.${P}pop__body--block .${P}v){display:block}
:where(.${P}h){font-weight:700;font-size:.85em;color:var(--vh-muted);margin-block:.3em}
:where(.${P}w-s){font-style:italic}
:where(.${P}w-d){font-variant:small-caps}
:where(.${P}w-w){color:var(--vh-words)}
:where(.${P}nowoc .${P}w-w){color:inherit}
:where(.${P}pop--sheet){inset:auto 0 0 0;width:auto;max-width:none;max-height:50vh;border-radius:12px 12px 0 0;padding-block-end:max(.8em,env(safe-area-inset-bottom))}
}`.replace(/\s*\n\s*/g, '');
