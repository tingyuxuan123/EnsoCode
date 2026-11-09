; electron-updater passes --updated, even from older one-click builds.
; Keep that path non-interactive; NSIS still uses the registered install directory
; and honors --force-run for the in-app restart.
!macro customInit
  ${if} ${isUpdated}
    SetSilent silent
  ${endif}
!macroend
