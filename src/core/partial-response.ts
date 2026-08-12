/**
 * Parser for PrimeFaces / JSF partial AJAX responses:
 *   <?xml version='1.0'?>
 *   <partial-response>
 *     <changes>
 *       <update id="form:panel"><![CDATA[<div>...</div>]]></update>
 *       <update id="javax.faces.ViewState"><![CDATA[...]]></update>
 *       <eval><![CDATA[PrimeFaces.cw(...)]]></eval>
 *     </changes>
 *   </partial-response>
 *
 * HTML inside CDATA is opaque text, so a small regex-based extraction is more
 * robust than a generic XML parser (which would choke on raw <div> markup).
 */
export interface PartialResponse {
  updates: Map<string, string>;
  evalBlocks: string[];
}

function stripCdata(s: string): string {
  return s.replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '');
}

export function parsePartialResponse(xml: string): PartialResponse {
  const updates = new Map<string, string>();
  const evalBlocks: string[] = [];

  const updateRe = /<update\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/update>/g;
  let m: RegExpExecArray | null;
  while ((m = updateRe.exec(xml)) !== null) {
    updates.set(m[1], stripCdata(m[2]));
  }

  const evalRe = /<eval[^>]*>([\s\S]*?)<\/eval>/g;
  while ((m = evalRe.exec(xml)) !== null) {
    evalBlocks.push(stripCdata(m[1]));
  }

  return { updates, evalBlocks };
}
