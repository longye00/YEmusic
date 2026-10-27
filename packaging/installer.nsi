; YEmusic Windows 安装程序（NSIS 3，Unicode）
;
; 用法（通常由 packaging/build-win.mjs 调用）：
;   makensis -DAPP_DIR=<已组装的 Windows 程序目录> -DOUT_FILE=<输出 exe> -DVERSION=0.2.0 \
;            -DICON=<icon.ico> -DWIZARD_BMP=<wizard.bmp> packaging/installer.nsi
;
; 特性：
;   * 按用户安装（无需管理员权限），默认 %LOCALAPPDATA%\Programs\YEmusic
;   * 自动识别旧版（0.1.x，electron-builder 打包）的安装位置并静默移除旧程序文件，保留用户数据
;   * 安装/卸载前自动检测并关闭正在运行的 YEmusic
;   * 卸载时可选删除用户数据（默认保留）

Unicode true
ManifestDPIAware true
ManifestSupportedOS all
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64

!ifndef APP_DIR
  !error "请通过 -DAPP_DIR=<目录> 指定要打包的程序目录"
!endif
!ifndef VERSION
  !define VERSION "0.2.0"
!endif
!ifndef OUT_FILE
  !define OUT_FILE "YEmusic-setup-${VERSION}.exe"
!endif
!ifndef ICON
  !define ICON "..\build\icon.ico"
!endif
!ifndef WIZARD_BMP
  !define WIZARD_BMP "wizard.bmp"
!endif

!define APP_NAME   "YEmusic"
!define APP_EXE    "YEmusic.exe"
!define PUBLISHER  "YEmusic contributors"
!define UNINST_EXE "Uninstall YEmusic.exe"
!define UNINST_ROOT "Software\Microsoft\Windows\CurrentVersion\Uninstall"
!define UNINST_KEY "${UNINST_ROOT}\${APP_NAME}"

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "x64.nsh"
!include "WinVer.nsh"

Name "${APP_NAME}"
OutFile "${OUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\${APP_NAME}"
InstallDirRegKey HKCU "${UNINST_KEY}" "InstallLocation"
BrandingText "${APP_NAME} ${VERSION}"
ShowInstDetails hide
ShowUninstDetails hide

; ---------------- 界面 ----------------
!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_WELCOMEFINISHPAGE_BITMAP "${WIZARD_BMP}"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "${WIZARD_BMP}"
!define MUI_ABORTWARNING

!define MUI_WELCOMEPAGE_TITLE "$(WelcomeTitle)"
!define MUI_WELCOMEPAGE_TEXT "$(WelcomeText)"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "$(RunApp)"
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchApp
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

LangString WelcomeTitle  ${LANG_SIMPCHINESE} "欢迎安装 YEmusic ${VERSION}"
LangString WelcomeTitle  ${LANG_ENGLISH}     "Welcome to YEmusic ${VERSION} Setup"
LangString WelcomeText   ${LANG_SIMPCHINESE} "YEmusic 融合了洛雪音乐的自定义音源生态与沉浸式的播放界面。$\r$\n$\r$\n如果电脑上装有旧版本，安装程序会自动替换旧版程序文件，你的歌单、收藏、音源和设置都会保留。$\r$\n$\r$\n点击“下一步”继续。"
LangString WelcomeText   ${LANG_ENGLISH}     "YEmusic combines the lx-music custom source ecosystem with an immersive player UI.$\r$\n$\r$\nAn existing older version will be replaced automatically; your playlists, favorites, sources and settings are kept.$\r$\n$\r$\nClick Next to continue."
LangString RunApp        ${LANG_SIMPCHINESE} "立即运行 YEmusic"
LangString RunApp        ${LANG_ENGLISH}     "Run YEmusic now"
LangString MsgRunning    ${LANG_SIMPCHINESE} "YEmusic 正在运行。$\r$\n$\r$\n点击“确定”关闭 YEmusic 并继续，点击“取消”退出。"
LangString MsgRunning    ${LANG_ENGLISH}     "YEmusic is running.$\r$\n$\r$\nClick OK to close it and continue, or Cancel to quit."
LangString MsgStillRunning ${LANG_SIMPCHINESE} "无法关闭 YEmusic。请从托盘图标退出 YEmusic 后点击“重试”。"
LangString MsgStillRunning ${LANG_ENGLISH}     "YEmusic could not be closed. Please quit it from the tray icon and click Retry."
LangString MsgNeedWin10  ${LANG_SIMPCHINESE} "YEmusic 需要 64 位 Windows 10 或更高版本。"
LangString MsgNeedWin10  ${LANG_ENGLISH}     "YEmusic requires 64-bit Windows 10 or later."
LangString MsgLegacy     ${LANG_SIMPCHINESE} "正在移除旧版本程序文件（保留用户数据）…"
LangString MsgLegacy     ${LANG_ENGLISH}     "Removing the previous version (user data is kept)..."
LangString MsgRemoveData ${LANG_SIMPCHINESE} "是否同时删除 YEmusic 的用户数据？$\r$\n（歌单、收藏、已导入的音源、设置和缓存，删除后无法恢复）"
LangString MsgRemoveData ${LANG_ENGLISH}     "Also delete YEmusic user data?$\r$\n(playlists, favorites, imported sources, settings and cache; this cannot be undone)"

VIProductVersion "${VERSION}.0"
VIFileVersion "${VERSION}.0"
VIAddVersionKey /LANG=${LANG_SIMPCHINESE} "ProductName" "${APP_NAME}"
VIAddVersionKey /LANG=${LANG_SIMPCHINESE} "CompanyName" "${PUBLISHER}"
VIAddVersionKey /LANG=${LANG_SIMPCHINESE} "FileDescription" "${APP_NAME} 安装程序"
VIAddVersionKey /LANG=${LANG_SIMPCHINESE} "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=${LANG_SIMPCHINESE} "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=${LANG_SIMPCHINESE} "LegalCopyright" "Copyright © 2026 ${PUBLISHER}"
VIAddVersionKey /LANG=${LANG_ENGLISH} "ProductName" "${APP_NAME}"
VIAddVersionKey /LANG=${LANG_ENGLISH} "CompanyName" "${PUBLISHER}"
VIAddVersionKey /LANG=${LANG_ENGLISH} "FileDescription" "${APP_NAME} Setup"
VIAddVersionKey /LANG=${LANG_ENGLISH} "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=${LANG_ENGLISH} "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=${LANG_ENGLISH} "LegalCopyright" "Copyright © 2026 ${PUBLISHER}"

Var LegacyKey   ; 旧版（electron-builder）在 Uninstall 下的子键名
Var LegacyDir   ; 旧版安装目录

; ---------------- 关闭正在运行的程序（安装/卸载共用） ----------------
!macro DEFINE_CLOSE_RUNNING un
Function ${un}IsRunning
  ; 返回值压栈："1" 表示有 YEmusic.exe 进程
  nsExec::Exec '"$SYSDIR\cmd.exe" /C ""$SYSDIR\tasklist.exe" /NH /FI "IMAGENAME eq ${APP_EXE}" | "$SYSDIR\find.exe" /I "${APP_EXE}" >NUL"'
  Pop $0
  ${If} $0 == "0"
    Push "1"
  ${Else}
    Push "0"
  ${EndIf}
FunctionEnd

Function ${un}CloseRunning
  Call ${un}IsRunning
  Pop $0
  ${If} $0 != "1"
    Return
  ${EndIf}
  ${IfNot} ${Silent}
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(MsgRunning)" IDOK +2
    Quit
  ${EndIf}
  retry:
  ; 关闭按钮默认最小化到托盘，因此直接结束进程
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /T /IM "${APP_EXE}"'
  Pop $0
  StrCpy $1 0
  wait:
    Sleep 500
    Call ${un}IsRunning
    Pop $0
    ${If} $0 != "1"
      Sleep 500 ; 等待文件句柄释放
      Return
    ${EndIf}
    IntOp $1 $1 + 1
    ${If} $1 < 10
      Goto wait
    ${EndIf}
  MessageBox MB_RETRYCANCEL|MB_ICONSTOP "$(MsgStillRunning)" /SD IDCANCEL IDRETRY retry
  Quit
FunctionEnd
!macroend
!insertmacro DEFINE_CLOSE_RUNNING ""
!insertmacro DEFINE_CLOSE_RUNNING "un."

; ---------------- 识别旧版安装 ----------------
Function FindLegacy
  StrCpy $LegacyKey ""
  StrCpy $LegacyDir ""
  StrCpy $R0 0
  loop:
    EnumRegKey $R1 HKCU "${UNINST_ROOT}" $R0
    StrCmp $R1 "" done
    IntOp $R0 $R0 + 1
    StrCmp $R1 "${APP_NAME}" loop ; 本安装程序自己的键
    ReadRegStr $R2 HKCU "${UNINST_ROOT}\$R1" "DisplayName"
    StrCpy $R3 $R2 8
    ${If} $R2 == "${APP_NAME}"
    ${OrIf} $R3 == "${APP_NAME} "
      ; electron-builder：InstallLocation 写在 HKCU\Software\<GUID>，卸载命令里也有路径
      ReadRegStr $R4 HKCU "Software\$R1" "InstallLocation"
      ${If} $R4 == ""
        ReadRegStr $R4 HKCU "${UNINST_ROOT}\$R1" "InstallLocation"
      ${EndIf}
      ${If} $R4 == ""
        ReadRegStr $R5 HKCU "${UNINST_ROOT}\$R1" "UninstallString"
        StrCpy $R6 $R5 1
        ${If} $R6 == '"'
          StrCpy $R5 $R5 "" 1
          StrCpy $R7 0
          qloop:
            StrCpy $R6 $R5 1 $R7
            StrCmp $R6 "" qdone
            StrCmp $R6 '"' qdone
            IntOp $R7 $R7 + 1
            Goto qloop
          qdone:
          StrCpy $R5 $R5 $R7
        ${EndIf}
        ${GetParent} $R5 $R4
      ${EndIf}
      ${If} $R4 != ""
      ${AndIf} ${FileExists} "$R4\${APP_EXE}"
        StrCpy $LegacyKey $R1
        StrCpy $LegacyDir $R4
        Goto done
      ${EndIf}
    ${EndIf}
    Goto loop
  done:
FunctionEnd

Function RemoveLegacy
  ${If} $LegacyKey == ""
    Return
  ${EndIf}
  DetailPrint "$(MsgLegacy)"
  ${If} ${FileExists} "$LegacyDir\${UNINST_EXE}"
    ; electron-builder 卸载程序：/S 静默，--updated 表示升级（不删除用户数据）
    ExecWait '"$LegacyDir\${UNINST_EXE}" /S /KEEP_APP_DATA --updated _?=$LegacyDir' $0
    DetailPrint "legacy uninstaller exit code: $0"
    Delete "$LegacyDir\${UNINST_EXE}"
  ${EndIf}
  ; 兜底清理旧版残留的注册表项和快捷方式
  DeleteRegKey HKCU "${UNINST_ROOT}\$LegacyKey"
  DeleteRegKey HKCU "Software\$LegacyKey"
  ${If} $LegacyDir != $INSTDIR
    RMDir /r "$LegacyDir\resources"
    RMDir /r "$LegacyDir\locales"
    Delete "$LegacyDir\${APP_EXE}"
    Delete "$LegacyDir\*.dll"
    Delete "$LegacyDir\*.pak"
    Delete "$LegacyDir\*.bin"
    Delete "$LegacyDir\*.dat"
    Delete "$LegacyDir\vk_swiftshader_icd.json"
    Delete "$LegacyDir\LICENSE.electron.txt"
    Delete "$LegacyDir\LICENSES.chromium.html"
    RMDir "$LegacyDir"
  ${EndIf}
FunctionEnd

Function .onInit
  ${IfNot} ${RunningX64}
  ${OrIfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "$(MsgNeedWin10)" /SD IDOK
    Abort
  ${EndIf}
  Call FindLegacy
  ; 未安装过本版本、且没有用 /D= 指定目录时，沿用旧版所在目录
  ReadRegStr $0 HKCU "${UNINST_KEY}" "InstallLocation"
  ${If} $0 == ""
  ${AndIf} $LegacyDir != ""
  ${AndIf} $INSTDIR == "$LOCALAPPDATA\Programs\${APP_NAME}"
    StrCpy $INSTDIR $LegacyDir
  ${EndIf}
FunctionEnd

Function LaunchApp
  SetOutPath "$INSTDIR"
  Exec '"$INSTDIR\${APP_EXE}"'
FunctionEnd

; ---------------- 安装 ----------------
Section "Install"
  SetShellVarContext current
  Call CloseRunning
  Call RemoveLegacy

  ; 升级本版本安装时清理旧运行时，避免残留过期文件
  ${If} ${FileExists} "$INSTDIR\${APP_EXE}"
    RMDir /r "$INSTDIR\resources"
    RMDir /r "$INSTDIR\locales"
  ${EndIf}

  SetOutPath "$INSTDIR"
  SetOverwrite on
  File /r "${APP_DIR}\*.*"

  WriteUninstaller "$INSTDIR\${UNINST_EXE}"

  CreateShortcut "$SMPROGRAMS\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0
  CreateShortcut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0

  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${APP_EXE},0"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\${UNINST_EXE}"'
  WriteRegStr HKCU "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\${UNINST_EXE}" /S'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" "$0"

  ; 通知资源管理器刷新图标
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
SectionEnd

; ---------------- 卸载 ----------------
Section "Uninstall"
  SetShellVarContext current
  Call un.CloseRunning

  Delete "$DESKTOP\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}.lnk"

  ; 只删除本程序的文件，避免误删安装目录中的其他内容
  Delete "$INSTDIR\${APP_EXE}"
  Delete "$INSTDIR\*.dll"
  Delete "$INSTDIR\*.pak"
  Delete "$INSTDIR\*.bin"
  Delete "$INSTDIR\icudtl.dat"
  Delete "$INSTDIR\vk_swiftshader_icd.json"
  Delete "$INSTDIR\LICENSE.electron.txt"
  Delete "$INSTDIR\LICENSES.chromium.html"
  Delete "$INSTDIR\LICENSE.txt"
  Delete "$INSTDIR\LICENSE-AGPL-3.0.txt"
  Delete "$INSTDIR\THIRD_PARTY_NOTICES.md"
  RMDir /r "$INSTDIR\locales"
  RMDir /r "$INSTDIR\resources"
  Delete "$INSTDIR\${UNINST_EXE}"
  RMDir "$INSTDIR"

  DeleteRegKey HKCU "${UNINST_KEY}"

  ${IfNot} ${Silent}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "$(MsgRemoveData)" IDNO +2
    RMDir /r "$APPDATA\${APP_NAME}"
  ${EndIf}

  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
SectionEnd
