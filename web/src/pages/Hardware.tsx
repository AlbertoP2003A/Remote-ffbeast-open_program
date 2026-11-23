import React from "react";
import { GroupFields } from "../components/GroupFields";
import { AdvancedSection } from "../components/controls";
import { Banner, Card, PageHeader } from "../components/ui";

export function Hardware(): React.ReactElement {
  return (
    <>
      <PageHeader
        title="Hardware"
        subtitle="Encoder, ganancias, límites y calibración."
      />

      <Banner tone="warn" icon="alert" title="Precaución">
        Potencia, frenado y calibración afectan a la fuerza real. Haz los cambios con el
        volante libre y sujeto, y prueba primero con valores bajos. La fuerza y el GPIO
        se aplican tras guardar y reiniciar; la app lo hará automáticamente al cambiarlos.
      </Banner>

      <Card title="Básicos">
        <GroupFields group="hardware" />
      </Card>

      <Card>
        <AdvancedSection hint="potencia, frenado y calibración">
          <GroupFields group="hardware" onlyAdvanced />
        </AdvancedSection>
      </Card>
    </>
  );
}
