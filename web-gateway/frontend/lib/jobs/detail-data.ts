import { cache } from "react";
import { fetchJob } from "@/lib/jobs/actions";

/**
 * The read a snapshot draft's page and its `generateMetadata` share. `cache`
 * keeps one request's answer, so the page and its title ask the backend once,
 * not twice (the action is a `"use server"` function and cannot be wrapped
 * where it is defined).
 */
export const getJob = cache(fetchJob);
