Unicode true
!include "MUI2.nsh"
!include "x64.nsh"
Name "Marx"
OutFile "..\dist\Marx-0.9.0-win-x64-setup.exe"
InstallDir "$LOCALAPPDATA\Programs\MarxWails"
RequestExecutionLevel user
SetCompressor /SOLID lzma
Icon "icon.ico"
UninstallIcon "icon.ico"
VIProductVersion "0.9.0.0"
VIAddVersionKey /LANG=1033 "ProductName" "Marx"
VIAddVersionKey /LANG=1033 "FileDescription" "Marx Windows x64 installer"
VIAddVersionKey /LANG=1033 "FileVersion" "0.9.0"
VIAddVersionKey /LANG=1033 "LegalCopyright" "MIT License"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "..\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH
!insertmacro MUI_LANGUAGE "English"
Function .onInit
 FindWindow $0 "MarxWailsWindow" "Marx"
 ${If} $0 != 0
  MessageBox MB_OK "Close Marx before installing or uninstalling it."
  SetErrorLevel 1
  Abort
 ${EndIf}
 ${IfNot} ${RunningX64}
  MessageBox MB_OK "This installer requires Windows x64."
  Abort
 ${EndIf}
FunctionEnd
Section "Marx"
 SetOutPath "$INSTDIR"
 File "..\dist\Marx.exe"
 WriteUninstaller "$INSTDIR\Uninstall Marx.exe"
 CreateShortcut "$SMPROGRAMS\Marx.lnk" "$INSTDIR\Marx.exe"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MarxWails" "DisplayName" "Marx"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MarxWails" "DisplayVersion" "0.9.0"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MarxWails" "UninstallString" '"$INSTDIR\Uninstall Marx.exe"'
 WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MarxWails" "NoModify" 1
 WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MarxWails" "NoRepair" 1
SectionEnd
Function un.onInit
 FindWindow $0 "MarxWailsWindow" "Marx"
 ${If} $0 != 0
  MessageBox MB_OK "Close Marx before installing or uninstalling it."
  SetErrorLevel 1
  Abort
 ${EndIf}
FunctionEnd
Section "Uninstall"
 Delete "$INSTDIR\Marx.exe"
 Delete "$INSTDIR\Uninstall Marx.exe"
 Delete "$SMPROGRAMS\Marx.lnk"
 DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MarxWails"
 RMDir "$INSTDIR"
SectionEnd
