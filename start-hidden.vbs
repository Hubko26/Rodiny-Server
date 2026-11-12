Rem Spusti server-loop.cmd bez okna (pouziva automaticke spustanie).
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.Run """" & dir & "\server-loop.cmd""", 0, False
