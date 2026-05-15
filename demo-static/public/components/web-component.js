function register(){
    if ('customElements' in window)
        window.customElements.define('web-component', WebComponent)
}

class WebComponent extends HTMLElement {
    connectedCallback() {
        console.log('hello')
    }
}

register()

export default WebComponent