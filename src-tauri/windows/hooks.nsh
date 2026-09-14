; NSIS installer hooks (see bundle.windows.nsis.installerHooks in tauri.conf.json).

; Tauri's uninstaller already deletes the HKCU Run value named after the
; product ("grimoire") on a real uninstall. Also remove the Task Manager
; override that launch-at-login may have left next to it. Skipped for
; updates, which run the previous uninstaller with /UPDATE.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${PRODUCTNAME}"
  ${EndIf}
!macroend
