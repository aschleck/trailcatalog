* Use bazelisk to build. For example if you want to see if the basic map compiles try building
  //js/s2viewer.
* Use `nix-shell -p <package> --run '<command>'` when you need a tool that isn't already on PATH.
  For example: `nix-shell -p postgresql --run 'psql -h mango ...'`. `brew` is not installed.
* Comments state the reason and stop. Name the thing that actually causes the problem. Say
  "callers pass coordinates outside of [-pi, pi] and S2LatLngRect rejects them", not "longitude
  keeps running as you pan, so lng is regularly outside [-pi, pi] and S2 won't build a rect like
  that anymore". Specifically, don't:
  * narrate the change ("anymore", "now", "used to", "we no longer") since the comment is read by
    someone who never saw the old code
  * restate what the next line does ("We rewrap it here")
  * add backstory that doesn't change what the reader should do
  * hedge or editorialize. No em dashes.
* Comment formatting:
  * Wrap at 100 columns counting indent and the `//`. Continuation lines are another `// ` at the
    same indent, never indented further.
  * A bare `//` separates paragraphs inside a block.
  * `//` for everything. `/** */` is only for a public function whose contract isn't obvious from
    the signature, and is usually one line in third person: `/** Renders instanced lines as
    rectangles without mitering. */`. Multi-paragraph KDoc/JSDoc uses ` * ` with a bare ` *`
    between paragraphs. There are ~13 of these against ~800 line comments.
  * Capitalize the first word. Terminal period on complete sentences, none on fragments and
    labels.
  * Trailing comments are lowercase fragments stating one fact about that line: `// in degrees,
    not radians`, `// no divide by 2 because the world is -1 to 1`.
  * `TODO(april):` with the parens, lowercase after the colon. Say what's wrong, and when it
    matters, why it isn't fixed: `// TODO(april): ideally we would query both fine and coarse
    because they may have different content, but that's annoying.`
  * Named-argument comments on literal call-site args: `/* minZoom= */ 9,`.
* What gets a comment:
  * A constant carries its derivation. `// Level 6 is the minimum because otherwise 47c4 is 7 MB
    with overview details.` `// 1609 meters to a mile, so at four bytes per meter we'd pay 6.4kb
    per mile.` Show the algebra as a chain of `// =>` lines when that's where the number came
    from.
  * Cite a spec, issue, or Stack Overflow answer as a bare URL on its own comment line, no prose
    around it. Cross-reference code by symbol: `See also render_planner.ts#render.`, `Keep in sync
    with ExtractRelations#relationToSkeleton`.
  * Label the field order before a CSV dump or a packed binary write:
    `// id,epoch,type,cell,name,s2_polygon,source_relation`.
  * Long procedures get section markers: `// First, get basic way geometries`, `// Now start
    resolving all of the relations' geometry`.
  * Answer the question a reader would ask about a non-obvious choice, in the reader's words:
    `// A good question to ask: is this safe?`, `// Why don't we need to dispose?`
  * Record an accepted limitation as what it is, without dressing it up. `// This method is kind
    of funny because it tries to be abstract about the types it's processing, but it ends up being
    type specific implicitly.` A terse punt (`// who cares`) is fine when the tradeoff was
    genuinely made and is genuinely small. Don't manufacture the tone when nothing was punted.
  * Nothing else. Obvious code goes uncommented.
* Comment voice: "we" for what the code does, "I" only for a judgment call that was a personal
  one. Reasons run through "because", "so", and "or else".
