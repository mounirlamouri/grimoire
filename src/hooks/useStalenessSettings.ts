import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export function useStalenessSettings() {
  const [stalenessWarningDays, setStalenessWarningDays] = useState(180);
  const [stalenessErrorDays, setStalenessErrorDays] = useState(365);
  const [hideStalenessWarnings, setHideStalenessWarnings] = useState(false);

  useEffect(() => {
    invoke<number>("get_staleness_warning_days").then(setStalenessWarningDays).catch(() => {});
    invoke<number>("get_staleness_error_days").then(setStalenessErrorDays).catch(() => {});
    invoke<boolean>("get_hide_staleness_warnings").then(setHideStalenessWarnings).catch(() => {});
  }, []);

  return { stalenessWarningDays, stalenessErrorDays, hideStalenessWarnings };
}
