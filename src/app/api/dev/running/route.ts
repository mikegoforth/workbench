import { NextRequest, NextResponse } from "next/server";
import { rejectNonLocal } from "@/lib/guard";
import { runningProjects } from "@/lib/devenv";

// GET /api/dev/running — names of projects with a dev environment, install,
// script or compose container running; the host ports their containers
// publish; containers that need a look (unhealthy, crash-looping, exited with
// an error); and whether the Docker daemon is up.
export async function GET(request: NextRequest) {
  const rejected = rejectNonLocal(request, { write: false });
  if (rejected) return rejected;
  const { projects, problems, docker } = await runningProjects();
  return NextResponse.json({
    running: projects.map((r) => r.name),
    ports: Object.fromEntries(projects.filter((r) => r.ports.length > 0).map((r) => [r.name, r.ports])),
    problems,
    docker,
  });
}
