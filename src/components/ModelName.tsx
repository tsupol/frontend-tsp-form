interface ModelNameProps {
  brand?: string;
  family: string;
  model?: string;
}

export function ModelName({ brand, family, model }: ModelNameProps) {
  return (
    <>
      {brand && <span className="text-[0.625rem] truncate">{brand}</span>}
      <span className="text-xs sm:text-[0.8125rem] font-medium text-info truncate">{family}</span>
      {model && <span className="text-xs sm:text-[0.8125rem] truncate">{model}</span>}
    </>
  );
}
