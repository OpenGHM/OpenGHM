import { cache } from "react";
import { fetchDatasetById, fetchModelInputById } from "@/lib/repository/actions";

/**
 * The reads a detail page and its `generateMetadata` share. `cache` keeps one
 * request's answer, so the page and its title ask the backend once, not twice
 * (the actions themselves are `"use server"` functions and cannot be wrapped
 * where they are defined).
 */
export const getDataset = cache(fetchDatasetById);
export const getModelInput = cache(fetchModelInputById);
