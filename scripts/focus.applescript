-- Focus the terminal that owns a given tty (best-effort, for agents started outside gta).
-- Usage: osascript focus.applescript <tty> <ownerApp>
-- Prints "ok:<app>" (exact tab focused), "app:<app>" (app raised), or "notfound".

on run argv
	set targetTTY to item 1 of argv
	set ownerApp to item 2 of argv

	if appRunning("iTerm2") then
		tell application "iTerm2"
			repeat with w in windows
				repeat with t in tabs of w
					repeat with s in sessions of t
						if (tty of s) ends with targetTTY then
							select w
							tell t to select
							tell s to select
							activate
							return "ok:iTerm2"
						end if
					end repeat
				end repeat
			end repeat
		end tell
	end if

	if appRunning("Terminal") then
		tell application "Terminal"
			repeat with w in windows
				repeat with t in tabs of w
					if (tty of t) ends with targetTTY then
						set selected tab of w to t
						set frontmost of w to true
						activate
						return "ok:Terminal"
					end if
				end repeat
			end repeat
		end tell
	end if

	-- Ghostty / Warp / others: no tty-per-tab scripting; raise the owning app.
	if ownerApp is not "" then
		try
			tell application ownerApp to activate
			return "app:" & ownerApp
		end try
	end if

	return "notfound"
end run

on appRunning(appName)
	tell application "System Events" to return (exists (processes where name is appName))
end appRunning
