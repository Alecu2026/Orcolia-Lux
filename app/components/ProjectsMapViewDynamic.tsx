"use client";

import nextDynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type ProjectsMapView from "./ProjectsMapView";

const ProjectsMapViewLazy = nextDynamic(() => import("./ProjectsMapView"), { ssr: false });

type Props = ComponentProps<typeof ProjectsMapView>;

export default function ProjectsMapViewDynamic(props: Props) {
  return <ProjectsMapViewLazy {...props} />;
}
