type PropertyFileCard = {
  id: string | number;
  isMine: boolean;
};

type PropertyFileCardTarget = {
  kind: "property-file-detail" | "modal";
  id: string | number;
};

export function propertyFileCardTarget({ id, isMine }: PropertyFileCard): PropertyFileCardTarget {
  return { kind: isMine === true ? "property-file-detail" : "modal", id };
}
