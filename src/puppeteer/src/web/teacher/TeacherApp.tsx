import { useEffect, useState } from "react";
import { ClassroomSession } from "./ClassroomSession";
import { TeacherPortal } from "./TeacherPortal";

export function TeacherApp() {
  const [view, setView] = useState<"dashboard" | "session">("dashboard");
  useEffect(() => {
    document.title =
      view === "session" ? "Classroom session · Socky" : "Teacher portal · Socky";
  }, [view]);
  if (view === "session")
    return <ClassroomSession onExit={() => setView("dashboard")} />;
  return <TeacherPortal onStartSession={() => setView("session")} />;
}
