; --updated must skip choices, not hide installation progress. Leave /S under
; electron-updater's control so a normal app quit still installs in the background.
!macro customInit
  ${if} ${isUpdated}
    SetAutoClose true
  ${endif}
!macroend

!ifndef BUILD_UNINSTALLER
  ; Reuse the registered scope, including the upstream per-machine UAC handling.
  !macro customInstallMode
    ${if} ${isUpdated}
      ${if} $installMode == "all"
        StrCpy $isForceMachineInstall "1"
      ${else}
        StrCpy $isForceCurrentInstall "1"
      ${endif}
    ${endif}
  !macroend

  ; The upstream directory page already skips updates, but instFilesPre would
  ; still append APP_FILENAME to an existing custom installation directory.
  !macro customPageAfterChangeDir
    !ifdef allowToChangeInstallationDirectory
      !undef MUI_PAGE_CUSTOMFUNCTION_PRE
      !define MUI_PAGE_CUSTOMFUNCTION_PRE collabraInstFilesPre
      Function collabraInstFilesPre
        ${ifNot} ${isUpdated}
          Call instFilesPre
        ${endif}
      FunctionEnd
    !endif
  !macroend

  ; Visible updates must not wait for Finish. The upstream assisted installer
  ; only handles --force-run in silent mode, so launch here for visible updates.
  !macro customFinishPage
    ; Match the upstream finish function, not its StartApp macro: that macro
    ; declares a global variable and is already expanded in installSection.
    Function collabraStartApp
      ${if} ${isUpdated}
        StrCpy $1 "--updated"
      ${else}
        StrCpy $1 ""
      ${endif}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd

    Function collabraFinishPre
      ${if} ${isUpdated}
        ${if} ${isForceRun}
          Call collabraStartApp
        ${endif}
        Abort
      ${endif}
    FunctionEnd

    !define MUI_PAGE_CUSTOMFUNCTION_PRE collabraFinishPre
    !ifndef HIDE_RUN_AFTER_FINISH
      !define MUI_FINISHPAGE_RUN
      !define MUI_FINISHPAGE_RUN_FUNCTION "collabraStartApp"
    !endif
    !insertmacro MUI_PAGE_FINISH
  !macroend
!endif
