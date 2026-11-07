import block from "../assets/minecraft-block.png";

/** Decorative by default. Pass `alt` only when the image carries information. */
export function MinecraftBlock({ size = "md", alt = "" }: { size?: "sm" | "md" | "lg"; alt?: string }) {
  const cls = size === "lg" ? "h-20 w-20" : size === "sm" ? "h-6 w-6" : "h-11 w-11";
  return <img src={block} alt={alt} aria-hidden={alt ? undefined : true} className={`${cls} object-contain`} />;
}
