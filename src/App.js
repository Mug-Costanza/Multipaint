import React, { useEffect } from 'react';

function App() {
  let canvas, ctx, drawing, lastX, lastY;

  const initializeCanvas = () => {
    canvas = document.getElementById('canvas');
    if (!canvas) return;

    ctx = canvas.getContext('2d');

    drawing = false;
    lastX = 0;
    lastY = 0;

    const handleMouseDown = (e) => startDrawing(e);
    const handleMouseMove = (e) => draw(e);
    const handleMouseUp = () => stopDrawing();
    const handleMouseOut = () => stopDrawing();

    const handleTouchStart = (e) => startDrawing(e.touches[0]);
    const handleTouchMove = (e) => draw(e.touches[0]);
    const handleTouchEnd = () => stopDrawing();

    // Add both mouse and touch event listeners to the canvas
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseout', handleMouseOut);

    canvas.addEventListener('touchstart', handleTouchStart);
    canvas.addEventListener('touchmove', handleTouchMove);
    canvas.addEventListener('touchend', handleTouchEnd);

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mouseout', handleMouseOut);

      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchmove', handleTouchMove);
      canvas.removeEventListener('touchend', handleTouchEnd);
    };
  };

  useEffect(() => {
    initializeCanvas();
  }, []); // No dependency array, as canvas doesn't depend on any prop or state

  const startDrawing = (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    [lastX, lastY] = [e.clientX - rect.left, e.clientY - rect.top];
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    drawing = true;
  };

  const draw = (e) => {
    e.preventDefault();
    if (!drawing) return;
    const rect = canvas.getBoundingClientRect();
    const [x, y] = [e.clientX - rect.left, e.clientY - rect.top];

    ctx.strokeStyle = '#000000'; // Set the stroke color (modify as needed)
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.stroke();

    [lastX, lastY] = [x, y];
  };

  const stopDrawing = () => {
    drawing = false;
  };

  return (
    <div className="App">
    </div>
  );
}

export default App;

