import { useContext } from "react";
import { GpuContext, type GpuContextValue } from "./GPUProvider.ts";

export function useGpu(): GpuContextValue {
  const value = useContext(GpuContext);
  if (!value) {
    throw new Error("@gpu-components/react: useGpu() must be called inside a <GPUProvider>");
  }
  return value;
}
