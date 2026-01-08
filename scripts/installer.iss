[Setup]
AppName=Codex Mate
AppVersion=0.0.1
AppPublisher=ymkiux
DefaultDirName={autopf}\CodexMate
DefaultGroupName=Codex Mate
OutputDir=.
OutputBaseFilename=CodexMate-Setup
Compression=lzma2
SolidCompression=yes

; 创建桌面快捷方式
[Icons]
Name: "{commondesktop}\Codex Mate"; Filename: "{app}\nw.exe"

; 创建开始菜单快捷方式
[Icons]
Name: "{group}\Codex Mate"; Filename: "{app}\nw.exe"

[Files]
; 复制整个 dist 目录的内容
Source: "dist\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Run]
; 安装完成后可选运行程序
Filename: "{app}\nw.exe"; Description: "启动 Codex Mate"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; 卸载时删除桌面快捷方式
[Icons]
Name: "{commondesktop}\Codex Mate"
