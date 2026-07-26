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
