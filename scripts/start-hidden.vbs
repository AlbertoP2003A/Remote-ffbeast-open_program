# Arranca el hub sin ventana de consola.
# Lo usa la tarea programada de Windows (install-autostart.ps1).
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
shell.CurrentDirectory = root

command = "node.exe ""hub\dist\index.js"""
shell.Run command, 0, False
