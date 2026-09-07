/**
 * Inlined multi-colour icons for the mobile study home and dictionary home.
 *
 * These are the exact SVG strings `@icon-park/svg` produced for the seven
 * call sites that used it, with the same props (theme 'multi-color', the same
 * four-colour fills, the same sizes). The package was 32 MB on disk to supply
 * seven static icons, and the rest of the app — including every icon in the
 * desktop client — already inlines its SVG, so the dependency was dropped and
 * its output frozen here.
 *
 * Rendered via `dangerouslySetInnerHTML`, exactly as the icon-park return
 * value was. The XML prolog icon-park emits is stripped: it is invalid inside
 * an HTML document and browsers ignore it at best.
 *
 * To change one of these, edit the markup directly — there is no generator to
 * re-run.
 */

/** Dictionary home — closed book (22px) */
export const BookOneSvg = "<svg width=\"22\" height=\"22\" viewBox=\"0 0 48 48\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M7 37C7 29.2967 7 11 7 11C7 7.68629 9.68629 5 13 5H35V31C35 31 18.2326 31 13 31C9.7 31 7 33.6842 7 37Z\" fill=\"#7986cb\" stroke=\"#5c6bc0\" stroke-width=\"4\" stroke-linejoin=\"round\"/><path d=\"M35 31C35 31 14.1537 31 13 31C9.68629 31 7 33.6863 7 37C7 40.3137 9.68629 43 13 43C15.2091 43 25.8758 43 41 43V7\" stroke=\"#5c6bc0\" stroke-width=\"4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M14 37H34\" stroke=\"#5c6bc0\" stroke-width=\"4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>";

/** Study home — notes */
export const NotepadSvg = "<svg width=\"48\" height=\"48\" viewBox=\"0 0 48 48\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M18 8H11C10.4477 8 10 8.44772 10 9V43C10 43.5523 10.4477 44 11 44H39C39.5523 44 40 43.5523 40 43V9C40 8.44772 39.5523 8 39 8H32\" stroke=\"#00695c\" stroke-width=\"4\"/><path d=\"M18 13V8H21.9505C21.9778 8 22 7.97784 22 7.9505V6C22 4.34315 23.3431 3 25 3C26.6569 3 28 4.34315 28 6V7.9505C28 7.97784 28.0222 8 28.0495 8H32V13C32 13.5523 31.5523 14 31 14H19C18.4477 14 18 13.5523 18 13Z\" fill=\"#26a69a\" stroke=\"#00695c\" stroke-width=\"4\"/></svg>";

/** Study home — cross-references */
export const ConnectionSvg = "<svg width=\"48\" height=\"48\" viewBox=\"0 0 48 48\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M39 34L44 39L39 44\" stroke=\"#1a73e8\" stroke-width=\"4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M8 12C10.2091 12 12 10.2091 12 8C12 5.79086 10.2091 4 8 4C5.79086 4 4 5.79086 4 8C4 10.2091 5.79086 12 8 12Z\" fill=\"#4fc3f7\" stroke=\"#1a73e8\" stroke-width=\"4\" stroke-linejoin=\"round\"/><path d=\"M12 8L20 8C22.2091 8 24 9.79086 24 12V35C24 37.2091 25.7909 39 28 39H44\" stroke=\"#1a73e8\" stroke-width=\"4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>";

/** Study home — topics */
export const CategoryManagementSvg = "<svg width=\"48\" height=\"48\" viewBox=\"0 0 48 48\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><rect x=\"6\" y=\"28\" width=\"36\" height=\"14\" rx=\"4\" stroke=\"#2e7d32\" stroke-width=\"4\"/><path d=\"M20 7H10C7.79086 7 6 8.79086 6 11V17C6 19.2091 7.79086 21 10 21H20\" stroke=\"#2e7d32\" stroke-width=\"4\" stroke-linecap=\"round\"/><circle cx=\"34\" cy=\"14\" r=\"8\" fill=\"#66bb6a\" stroke=\"#2e7d32\" stroke-width=\"4\"/><circle cx=\"34\" cy=\"14\" r=\"3\" fill=\"#fff\"/></svg>";

/** Study home — commentary */
export const CommentOneSvg = "<svg width=\"48\" height=\"48\" viewBox=\"0 0 48 48\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M44 6H4V36H13V41L23 36H44V6Z\" fill=\"#ffa726\" stroke=\"#e65100\" stroke-width=\"4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M14 21H34\" stroke=\"#fff\" stroke-width=\"4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>";

/** Study home — books */
export const BookOpenSvg = "<svg width=\"48\" height=\"48\" viewBox=\"0 0 48 48\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M5 7H16C20.4183 7 24 10.5817 24 15V42C24 38.6863 21.3137 36 18 36H5V7Z\" fill=\"#ab47bc\" stroke=\"#6a1b9a\" stroke-width=\"4\" stroke-linejoin=\"round\"/><path d=\"M43 7H32C27.5817 7 24 10.5817 24 15V42C24 38.6863 26.6863 36 30 36H43V7Z\" fill=\"#ab47bc\" stroke=\"#6a1b9a\" stroke-width=\"4\" stroke-linejoin=\"round\"/></svg>";

/** Study home — interlinear / original languages */
export const TranslateSvg = "<svg width=\"48\" height=\"48\" viewBox=\"0 0 48 48\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M28.2857 37H39.7143M42 42L39.7143 37L42 42ZM26 42L28.2857 37L26 42ZM28.2857 37L34 24L39.7143 37H28.2857Z\" stroke=\"#c62828\" stroke-width=\"4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M16 6L17 9\" stroke=\"#c62828\" stroke-width=\"4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M6 11H28\" stroke=\"#c62828\" stroke-width=\"4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M10 16C10 16 11.7895 22.2609 16.2632 25.7391C20.7368 29.2174 28 32 28 32\" stroke=\"#c62828\" stroke-width=\"4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M24 11C24 11 22.2105 19.2174 17.7368 23.7826C13.2632 28.3478 6 32 6 32\" stroke=\"#c62828\" stroke-width=\"4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>";

/** Study tab bar — cross-references (22px) */
export const ConnectionSmallSvg = "<svg width=\"22\" height=\"22\" viewBox=\"0 0 48 48\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M39 34L44 39L39 44\" stroke=\"#1a73e8\" stroke-width=\"4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M8 12C10.2091 12 12 10.2091 12 8C12 5.79086 10.2091 4 8 4C5.79086 4 4 5.79086 4 8C4 10.2091 5.79086 12 8 12Z\" fill=\"#4fc3f7\" stroke=\"#1a73e8\" stroke-width=\"4\" stroke-linejoin=\"round\"/><path d=\"M12 8L20 8C22.2091 8 24 9.79086 24 12V35C24 37.2091 25.7909 39 28 39H44\" stroke=\"#1a73e8\" stroke-width=\"4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>";

/** Study tab bar — topics (22px) */
export const CategoryManagementSmallSvg = "<svg width=\"22\" height=\"22\" viewBox=\"0 0 48 48\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><rect x=\"6\" y=\"28\" width=\"36\" height=\"14\" rx=\"4\" stroke=\"#2e7d32\" stroke-width=\"4\"/><path d=\"M20 7H10C7.79086 7 6 8.79086 6 11V17C6 19.2091 7.79086 21 10 21H20\" stroke=\"#2e7d32\" stroke-width=\"4\" stroke-linecap=\"round\"/><circle cx=\"34\" cy=\"14\" r=\"8\" fill=\"#66bb6a\" stroke=\"#2e7d32\" stroke-width=\"4\"/><circle cx=\"34\" cy=\"14\" r=\"3\" fill=\"#fff\"/></svg>";

/** Study tab bar — commentary (22px) */
export const CommentOneSmallSvg = "<svg width=\"22\" height=\"22\" viewBox=\"0 0 48 48\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M44 6H4V36H13V41L23 36H44V6Z\" fill=\"#ffa726\" stroke=\"#e65100\" stroke-width=\"4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M14 21H34\" stroke=\"#fff\" stroke-width=\"4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>";

/** Study tab bar — dictionary (22px) */
export const BookOpenSmallSvg = "<svg width=\"22\" height=\"22\" viewBox=\"0 0 48 48\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M5 7H16C20.4183 7 24 10.5817 24 15V42C24 38.6863 21.3137 36 18 36H5V7Z\" fill=\"#ab47bc\" stroke=\"#6a1b9a\" stroke-width=\"4\" stroke-linejoin=\"round\"/><path d=\"M43 7H32C27.5817 7 24 10.5817 24 15V42C24 38.6863 26.6863 36 30 36H43V7Z\" fill=\"#ab47bc\" stroke=\"#6a1b9a\" stroke-width=\"4\" stroke-linejoin=\"round\"/></svg>";
