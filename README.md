# AburráLoop

Simulador de última milla para comercio electrónico con pago contra entrega (COD) en el Valle de Aburrá.

Compara dos modelos:

- **Tradicional:** los paquetes fallidos vuelven como peso muerto al CEDI.
- **Nodos móviles de triaje:** mini-vans pivote interceptan la novedad en la calle y re-despachan el mismo día.

**Demo:** https://harelo-dev.github.io/aburraloop/

![Captura](docs/screenshot.png)

## Qué calcula

- Retorno físico evitado (% de fallos que no vuelven al CEDI).
- Capital recuperado por día: flete de ida y vuelta ahorrado más margen de los productos rescatados.
- Costo diario de las vans.
- Peso muerto por motorizado: paquetes fallidos que cada moto carga sin punto de descarga intermedio.

La van puede operar de dos formas: **interceptar** los fallos en la calle, o **recorrer** a cada moto una vez en la mañana y otra en la tarde y servir de punto de cierre, de modo que la moto no vuelve al CEDI. Debajo del mapa hay un análisis con cinco vistas, promediadas sobre 8 días simulados:

- **¿Intercepta o recorre?** los dos modos con 1, 2 y 3 vans, lado a lado.
- **Cuántas vans conviene** según el neto diario.
- **Punto de equilibrio:** desde cuántos despachos diarios se paga cada van y cuándo la 2.ª y la 3.ª superan a la anterior.
- **Dónde poner las vans:** fijas por zona, según los fallos de días previos o con conocimiento del día (un techo no alcanzable), con tres criterios: mayor alcance, mayor valor neto o concentración de paquetes.
- **Sensibilidad:** qué supuesto mueve más el resultado.

Los parámetros de entrada son el CEDI base, el volumen diario (150–1.200), la flota (5–45 motos), la tasa de novedad (5–30%) y de 0 a 3 mini-vans. Además se ajustan el tiempo máximo de viaje de la van, la distancia mínima de la van al CEDI, el éxito del segundo intento, qué parte del margen se pierde si un paquete vuelve al CEDI y el costo del desvío de la moto.

## Cómo funciona

- Los incidentes se generan con una semilla fija, así que la misma configuración da el mismo resultado.
- El alcance de una van se mide en **minutos por carretera**, no en radio en línea recta. En un valle largo y angosto la diferencia es grande.
- Los tiempos salen de matrices precalculadas con OSRM (`src/data/`), así que la app es 100% estática.
- El mapa usa [MapLibre GL](https://maplibre.org/) con tiles de [OpenFreeMap](https://openfreemap.org/).

Todos los supuestos y sus límites están en [ASSUMPTIONS.md](ASSUMPTIONS.md). **Son datos sintéticos**: la simulación muestra cómo se comporta la idea, no predice una operación concreta.

## Desarrollo

```bash
npm install
npm run dev          # servidor de desarrollo
npm test             # tests de la simulación
npm run build        # typecheck + build de producción
npm run build:matrix     # tiempos desde zonas y CEDIs (servidor demo de OSRM)
npm run build:cellmatrix # tiempos entre todas las celdas (tarda unos 3 minutos)
```

Requiere Node 20 o superior.

## Stack

Vite, React, TypeScript, MapLibre GL, Vitest.

## Licencia

[MIT](LICENSE) © Haider Rendón
