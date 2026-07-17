"use client";

import nextDynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type ProjectMap from "./ProjectMap";

const ProjectMapLazy = nextDynamic(() => import("./ProjectMap"), { ssr: false });

type Props = ComponentProps<typeof ProjectMap>;

export default function ProjectMapDynamic(props: Props) {
  return <ProjectMapLazy {...props} />;
}
