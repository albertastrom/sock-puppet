import { createRoot } from "react-dom/client";
import { App } from "./App";
import { TeacherApp } from "./teacher/TeacherApp";
import "./style.css";

const path = location.pathname.replace(/\/$/, "") || "/";
createRoot(document.getElementById("root")!).render(
  path === "/teacher" ? <TeacherApp /> : <App />,
);
