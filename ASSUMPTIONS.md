# Supuestos del modelo

AburráLoop es una simulación con **datos sintéticos**. Nada aquí viene de una operación real. Cada número de abajo es un supuesto editable en `src/sim/simulate.ts`; los que están en la interfaz se mueven con sliders.

## Qué se simula

Un día de despachos de última milla con pago contra entrega (COD) en los 10 municipios del Valle de Aburrá.

1. Se calcula cuántos paquetes fallan: `despachos × tasa de novedad`.
2. Cada paquete fallido se ubica en un municipio según su peso comercial, con dispersión gaussiana alrededor de su centro (σ entre 1,5 y 3,5 km), y se ajusta a la celda de ~1 km más cercana de la matriz de viaje.
3. Cada fallo recibe una hora (08:00–16:30), un valor COD ($85k–$150k) y un grado de potencial de triaje.
4. Una mini-van intercepta un paquete si el **tiempo por carretera** desde su ubicación es menor o igual al máximo configurado, el grado es A o B y la van no superó su capacidad del día. Si varias vans alcanzan el paquete, va la más cercana que aún tenga capacidad. Los paquetes se atienden en orden de hora.
5. Un paquete interceptado se salva con cierta probabilidad. Si no se salva, vuelve al CEDI igual.

## Parámetros

| Supuesto | Valor | Dónde |
| --- | --- | --- |
| Peso de envíos | Medellín 48%, Norte 24%, Sur 28% | `src/data/places.json` |
| Mezcla de fallos | 45% Grado A, 25% Grado B, 30% Grado C | `ASSUMPTIONS.gradeShare` |
| Éxito 2.º intento, Grado A | 60% (slider 30–90%) | UI |
| Éxito liquidación flash, Grado B | 80% | `ASSUMPTIONS.gradeBSuccess` |
| Margen recuperado | 28% del COD (A), 12% (B) | `marginA`, `marginB` |
| Flete ahorrado | $900 por km, ida y vuelta al CEDI, más $4.000 de manejo | `freightCopPerKm`, `handlingCop` |
| Costo de una van | $320.000 por día | `vanCostCopPerDay` |
| Capacidad de una van | 80 paquetes por día | `vanCapacity` |
| Tiempo máximo van → paquete | 25 min (slider 10–45) | UI |

## Dónde van las vans

La ubicación se escoge una vez por día y se puede cambiar en la interfaz. Una **distancia mínima van → CEDI** (10 minutos por defecto, entre 0 y 20) vale para las tres estrategias: una van pegada al CEDI no intercepta nada que el CEDI no reciba igual, así que esas celdas quedan fuera. Con CEDI Sur, por ejemplo, la van única va al norte y no al sur.

- **Fijas por zona:** Norte (Bello), Centro (Medellín) y Sur (Itagüí), según cuántas vans haya. Si un ancla queda demasiado cerca del CEDI se descarta, y esa van se ubica donde indica el historial.
- **Según concentración de fallos (por defecto):** cobertura máxima voraz. Cada van se pone en la celda que alcanza, dentro del tiempo máximo, el mayor valor esperado de rescate que no cubre otra van. El valor esperado de un fallo es la probabilidad de que el segundo intento funcione por lo que recupera. La concentración sale del promedio de **10 días simulados previos**, distintos del día evaluado, como si fuera el historial de la operación.
- **Con conocimiento del día (techo):** el mismo algoritmo, alimentado con los fallos del propio día. No se puede lograr en la práctica y sirve solo como cota superior de lo que da una buena ubicación.

El algoritmo voraz no garantiza el óptimo exacto. Los fallos son proporcionales a los despachos de cada municipio, así que la concentración de fallos sigue la de las entregas.

## Análisis de la interfaz

Las cuatro tarjetas de análisis promedian **8 días simulados** (semillas consecutivas) con los parámetros actuales. Si eliges 0 vans, usan 2.

- **Cuántas vans:** neto por día (capital recuperado menos costo de las vans) con 0 a 3 vans.
- **Punto de equilibrio:** neto por día según despachos diarios (150 a 1.200) para 1, 2 y 3 vans, con la tasa de novedad actual. Los cruces se interpolan linealmente entre puntos de 50 despachos.
- **Dónde poner las vans:** las tres estrategias de arriba, lado a lado.
- **Sensibilidad:** cada supuesto se mueve hacia abajo y hacia arriba con todo lo demás fijo. Rangos: éxito del 2.º intento ±20 puntos, tasa de novedad ±5 puntos, tiempo máximo ±10 min, proporción de Grado A 35% a 55% (Grado C compensa), éxito de Grado B 65% a 95%, margen de Grado A 20% a 36%, costo de van ±25%, flete ±33%, capacidad de la van 40 a 120 paquetes y valor COD ±20%.

Los rangos son un juicio razonable, no intervalos medidos. Con datos reales se reemplazan por los observados.

## Matriz de tiempos de viaje

Dos archivos, generados una sola vez con el servidor demo público de OSRM (perfil de carro). La app no llama a ningún servicio de rutas en vivo.

- `src/data/travel.json`: para una malla de ~1 km sobre el valle (443 celdas), el tiempo y la distancia por carretera desde los puntos de referencia de las zonas y desde cada CEDI. Se genera con `npm run build:matrix`. La distancia al CEDI alimenta el flete ahorrado.
- `src/data/cell-minutes.json`: minutos por carretera entre **cada par de celdas** (443 × 443), redondeados al minuto. Se genera con `npm run build:cellmatrix` y es lo que permite poner una van en cualquier celda. Los 138 pares sin ruta se tratan como inalcanzables. Los tiempos no son simétricos porque hay calles de un solo sentido.

Limitaciones: es tiempo de carro sin tráfico por hora del día, y las motos suelen ser más rápidas en trancón. Las líneas rojas del mapa son rectas y solo ilustran el viaje de retorno; el flete ahorrado sí usa la distancia por carretera.

## Limitación conocida: el margen se cuenta completo

Cada paquete rescatado suma su flete ahorrado y el margen completo del producto (28% o 12% del COD). Pero un paquete que vuelve al CEDI no siempre pierde esa venta: puede reofrecerse al día siguiente. Por eso el modelo probablemente sobrestima el valor de rescatar paquetes cerca del CEDI, y la distancia mínima es un parche para eso. Lo más correcto sería atribuir solo la parte del margen que realmente se pierde al volver, y la ganancia de entregar el mismo día. Es un parámetro que falta.

## Lo que el modelo no hace todavía

- Las vans se ubican una vez por día y no se mueven mientras trabajan.
- No hay variación de tráfico por hora.
- Los grados A, B y C son una proporción fija, no una clasificación de paquetes reales.
- Los costos son estimaciones redondas, no cotizaciones.

## Cómo calibrarlo con datos reales

Con 30 días de intentos fallidos de una operación (hora, dirección, motivo, valor y desenlace del reintento) se reemplazan la mezcla de grados, la tasa de éxito del segundo intento y la distribución espacial. La estructura del código ya separa esos supuestos del motor.
