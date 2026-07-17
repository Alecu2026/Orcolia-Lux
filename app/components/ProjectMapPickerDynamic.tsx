"use client";

import nextDynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type ProjectMapPicker from "./ProjectMapPicker";

const ProjectMapPickerLazy = nextDynamic(() => import("./ProjectMapPicker"), { ssr: false });

type Props = ComponentProps<typeof ProjectMapPicker>;

export default function ProjectMapPickerDynamic(props: Props) {
  return <ProjectMapPickerLazy {...props} />;
}
