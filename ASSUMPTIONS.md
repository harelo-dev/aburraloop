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
| Margen del producto | 28% del COD (A), 12% (B) | `marginA`, `marginB` |
| Parte del margen que se pierde si vuelve al CEDI | 50% (slider 10–100%) | UI |
| Flete ahorrado | $900 por km, ida y vuelta al CEDI, más $4.000 de manejo | `freightCopPerKm`, `handlingCop` |
| Costo de una van | $320.000 por día | `vanCostCopPerDay` |
| Capacidad de una van | 80 paquetes por día | `vanCapacity` |
| Costo del desvío de la moto | $300 por minuto, ida y vuelta hacia la van (slider $0–1.500) | UI |
| Tiempo máximo van → paquete | 25 min (slider 10–45) | UI |

## Cuánto se recupera

Cada paquete salvado suma el flete ahorrado ($900 por km de carretera hasta el CEDI, ida y vuelta, más $4.000 de manejo) y **solo la parte del margen que de verdad se pierde al volver al CEDI**. Un paquete devuelto puede reofrecerse al día siguiente, así que contar el margen completo sobrestimaría el rescate. Con el valor por defecto de 50%, cada rescate suma la mitad del margen.

El **neto** es lo recuperado menos el costo de las vans menos el **costo de desvío**: cada paquete entregado a una van obliga a la moto a ir hasta ella y volver a su ruta, y ese tiempo cuesta ($300 por minuto, ida y vuelta, se usa el tiempo de carretera entre el paquete y la van). Así, acercar las vans a la concentración de paquetes tiene un valor en el modelo.

## Dónde van las vans

La ubicación se escoge una vez por día. Se combinan dos decisiones en la interfaz.

**Qué información se usa**

- **Según fallos de días previos (por defecto):** el promedio de **10 días simulados previos**, distintos del día evaluado, como si fuera el historial de la operación.
- **Fijas por zona:** Norte (Bello), Centro (Medellín) y Sur (Itagüí), según cuántas vans haya. Si un ancla queda demasiado cerca del CEDI se descarta, y esa van se ubica donde indica el historial y el criterio elegido.
- **Con conocimiento del día (techo):** los fallos del propio día. No se puede lograr en la práctica y sirve como cota de lo que da una buena ubicación.

**Con qué criterio** (algoritmos voraces: agregan una van a la vez)

- **Mayor alcance:** cada van va donde cubre, dentro del tiempo máximo, el mayor valor esperado que ninguna otra cubre ya. Tiende a mandar la 2.ª van lejos del núcleo.
- **Mayor valor neto (por defecto):** modela el día con la capacidad de cada van (80 paquetes) y el desvío de la moto, y pone cada van donde sube más el neto total.
- **Concentración de paquetes:** minimiza el tiempo total de carretera hasta los paquetes, contando paquetes y no pesos (p-mediana voraz). Un paquete que ninguna van alcanza cuenta como el doble del alcance máximo, así que el alcance sigue importando.

Una **distancia mínima van → CEDI** (10 minutos por defecto, entre 0 y 20) vale para todas las combinaciones: una van pegada al CEDI no intercepta nada que el CEDI no reciba igual, así que esas celdas quedan fuera. Con CEDI Sur, por ejemplo, la van única va al norte y no al sur.

El valor esperado de un fallo es la probabilidad de que el segundo intento funcione por lo que recupera. Los fallos son proporcionales a los despachos de cada municipio, así que la concentración de fallos sigue la de las entregas.

### Qué encontramos al comparar

Con 2 vans, 6 días simulados, CEDI Centro y los parámetros por defecto, probamos **todos los pares posibles** de celdas contra los algoritmos voraces:

| Escenario | Mejor par posible | Mejor par solo en el núcleo | Voraz (valor neto) |
| --- | --- | --- | --- |
| 600 despachos, 15% | Medellín + Girardota, $533 k | Medellín + Bello, $436 k | $522 k |
| 900 despachos, 15% | Medellín + Girardota, $1,17 M | Envigado + Bello, $967 k | $1,16 M |
| 1.200 despachos, 25% | Medellín + Girardota, $2,38 M | Envigado + Bello, $2,18 M | $2,40 M |

- La mejor 2.ª van **no** se queda en el núcleo denso. La van de Medellín, con 25 minutos de alcance, ya cubre casi todo el núcleo y todavía le sobra capacidad. La segunda van rinde más alcanzando el norte (Bello, Copacabana, Girardota y Barbosa suman 24% de los envíos), que de otro modo vuelve entero al CEDI.
- Partir el núcleo en dos cuesta entre $100 y $200 mil netos por día en estos escenarios.
- Cambia con el alcance: con **15 minutos**, la 2.ª van sí parte el núcleo (Medellín + Sabaneta con el criterio de concentración), porque la primera ya no cubre todo.
- El algoritmo de valor neto queda a menos de 2% del mejor par en estos tres casos. El de mayor alcance queda 20% o más por debajo.
- Subir el costo del desvío no cambia esa conclusión: a $600 por minuto o más, ni siquiera una van se paga con 600 despachos.

Son resultados de un modelo sintético. Con una distribución real de fallos pueden cambiar.

## Análisis de la interfaz

Las cuatro tarjetas de análisis promedian **8 días simulados** (semillas consecutivas) con los parámetros actuales. Si eliges 0 vans, usan 2.

- **Cuántas vans:** neto por día (recuperado menos costo de las vans y de los desvíos) con 0 a 3 vans.
- **Punto de equilibrio:** neto por día según despachos diarios (150 a 1.200) para 1, 2 y 3 vans, con la tasa de novedad actual. Los cruces se interpolan linealmente entre puntos de 50 despachos.
- **Dónde poner las vans:** zonas fijas, historial con cada criterio y el techo con conocimiento del día, lado a lado.
- **Sensibilidad:** cada supuesto se mueve hacia abajo y hacia arriba con todo lo demás fijo. Rangos: éxito del 2.º intento ±20 puntos, tasa de novedad ±5 puntos, tiempo máximo ±10 min, proporción de Grado A 35% a 55% (Grado C compensa), éxito de Grado B 65% a 95%, margen de Grado A 20% a 36%, parte del margen que se pierde ±25 puntos, costo del desvío $150 a $450 por minuto, costo de van ±25%, flete ±33%, capacidad de la van 40 a 120 paquetes y valor COD ±20%.

Los rangos son un juicio razonable, no intervalos medidos. Con datos reales se reemplazan por los observados.

## Matriz de tiempos de viaje

Dos archivos, generados una sola vez con el servidor demo público de OSRM (perfil de carro). La app no llama a ningún servicio de rutas en vivo.

- `src/data/travel.json`: para una malla de ~1 km sobre el valle (443 celdas), el tiempo y la distancia por carretera desde los puntos de referencia de las zonas y desde cada CEDI. Se genera con `npm run build:matrix`. La distancia al CEDI alimenta el flete ahorrado.
- `src/data/cell-minutes.json`: minutos por carretera entre **cada par de celdas** (443 × 443), redondeados al minuto. Se genera con `npm run build:cellmatrix` y es lo que permite poner una van en cualquier celda. Los 138 pares sin ruta se tratan como inalcanzables. Los tiempos no son simétricos porque hay calles de un solo sentido.

Limitaciones: es tiempo de carro sin tráfico por hora del día, y las motos suelen ser más rápidas en trancón. Las líneas rojas del mapa son rectas y solo ilustran el viaje de retorno; el flete ahorrado sí usa la distancia por carretera.

## Lo que el modelo no hace todavía

- Las vans se ubican una vez por día y no se mueven mientras trabajan.
- La ubicación se calcula suponiendo que cada van atiende primero los paquetes más valiosos, pero en la simulación se atiende por orden de hora, que es lo que haría una operación real. Con la capacidad llena, eso puede hacer que más alcance rinda menos.
- El tiempo de respuesta no cambia la probabilidad de éxito del segundo intento; solo cuesta el desvío de la moto.
- No hay variación de tráfico por hora.
- Los grados A, B y C son una proporción fija, no una clasificación de paquetes reales.
- Los costos son estimaciones redondas, no cotizaciones.

## Cómo calibrarlo con datos reales

Con 30 días de intentos fallidos de una operación (hora, dirección, motivo, valor y desenlace del reintento) se reemplazan la mezcla de grados, la tasa de éxito del segundo intento y la distribución espacial. La estructura del código ya separa esos supuestos del motor.
