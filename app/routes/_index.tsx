import { Form } from "react-router";
import { Welcome } from "../welcome/welcome";
import type { Route } from "./+types/_index";
import { route } from "@react-router/dev/routes";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "New React Router App" },
    { name: "description", content: "Welcome to React Router!" },
  ];
}

export default function Home() {
  return <Form action={"/api/repos/add"} />;
}
